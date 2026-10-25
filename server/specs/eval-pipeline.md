# Eval Pipeline — server

A regression harness for reviewer agents: triaged findings become frozen eval
cases, a run replays one agent version over the agent's case set in the
background, and code (never a model) scores the output into recall, precision
and citation accuracy. This file owns the data model, the API, the freezing and
scoring rules and the derived reads. The UI half is
[`client/specs/eval-pipeline.md`](../../client/specs/eval-pipeline.md).

Spec: specs/eval-pipeline.md (SPEC-04)

Status: **implemented 2026-10-25**. Runs are manual only: nothing starts a run
after a prompt save, a review or on a schedule.

## Data model (migrations `0018_eval_suite_runs.sql`, `0019_eval_drop_per_case_columns.sql`)

Both tables were reserved at zero rows, so they are reshaped in place.

| Table / column | Role |
|---|---|
| `eval_cases.input_diff` / `input_files` / `input_meta` / `expected_output` | now `NOT NULL`. `expected_output` keeps its column name and stores the `EvalExpectation` object (`{ type, file, start_line, end_line, severity, category, title }`); the DTO field is `expectation` |
| `eval_cases.source_finding_id` | the finding a case was created from, no FK (a case outlives its finding); null for a hand-authored case |
| `eval_cases.created_at` / `updated_at` | timestamps |
| `eval_cases_source_finding_uq` | unique index on `(source_finding_id, owner_kind, owner_id)`: "Turn into eval case" is idempotent per finding and agent |
| `eval_cases_owner_idx` | index on `(workspace_id, owner_kind, owner_id)` |
| `eval_runs` | one row per RUN: `workspace_id`, `owner_kind` / `owner_id` (the agent), `scope` `suite` \| `case`, `status` `running` \| `completed` \| `errored`, `agent_version`, `case_ids` jsonb, `ran_at`, `finished_at`, `per_case` jsonb (`EvalCaseOutcome[]`), `cases_errored`, `traces_passed`, `traces_total`, `recall`, `precision`, `citation_accuracy`, `duration_ms`, `cost_usd`, `error_reason`. The reserved `case_id`, `actual_output`, `pass` columns are dropped |
| `eval_runs_owner_idx` | index on `(workspace_id, owner_kind, owner_id, ran_at desc)` |

`eval_runs` has no FK to `eval_cases`: deleting a case keeps every run's
stored outcomes. The seed writes a version-1 `agent_versions` snapshot for each
seeded agent so the compare view can diff prompts from v1.

## Contracts (`vendor/shared/contracts`)

`knowledge.ts`: `EvalExpectationType`, `EvalExpectation`, `EvalCaseMeta`,
`EvalActualFinding`, `EvalCaseOutcome`, `EvalRun` (nullable ratios,
`cases_errored`, `per_case`), `EvalCase`. `eval-ci.ts`: `EvalCaseInput`,
`EvalCaseFromFindingResult`, `EvalRunStatus`, `EvalRunScope`, `EvalRunRecord`,
`EvalRunInput`, `EvalRunEstimate`, `EvalRunResult`, `EvalRunAllResult`,
`EvalTrendPoint`, `EvalMetricKey`, `EvalCallout`, `EvalMetricDeltas`,
`EvalAgentSummary`, `EvalDashboard`, `EvalAgentDetail`, `EvalPromptDiffLine`,
`EvalCompare`. The client copy under `client/src/vendor/shared` mirrors both.

## Module (`modules/eval/`)

| File | Role |
|---|---|
| `routes.ts` | composition point; `getContext` first on every route; zod `params` / `body` / `querystring` |
| `service.ts` | `EvalService`: cases, runs (start → background `executeRun`), dashboard, agent detail, compare |
| `repository.ts` | `EvalRepository`: owns `eval_cases` / `eval_runs`; reads `findings` → `reviews` → `pull_requests` and `pr_files.patch` only at freeze time |
| `executor.ts` | `EvalExecutor.runCase`: the same `reviewPullRequest` engine as live reviews with only prompt, model, strategy, frozen diff, frozen PR body and a fixed task line |
| `scoring.ts` | pure: `matches`, `scoreCase`, `errorCaseOutcome`, `scoreRun`, `metricsOverCases`, `metricDeltas`, `caseTransitions` |
| `frozen-input.ts` | `synthesizeFrozenDiff`, `isExpectationGrounded` (reuses `groundFindings`), `slugify` |
| `prompt-diff.ts` | LCS line diff of two system prompts |
| `callout.ts` | `buildCallout`: largest-moving metric between the two latest completed suite runs + flipped cases |
| `ports.ts` | `AgentLookup` (`getById`, `list`, `getVersion`), `LlmResolver`, `Logger`; satisfied by `container.agentsRepo` / `container.llm` / `app.log` |
| `constants.ts` | see below |

| Constant | Value | Meaning |
|---|---|---|
| `EVAL_TASK_LINE` | text | task framing for an eval execution; keeps the "never withhold a security finding" rule |
| `STALE_RUN_TIMEOUT_MS` | 15 min | a `running` run older than this is reconciled to `errored` on the next start |
| `RUN_RATE_LIMIT` | `{ max: 5, timeWindow: '1 minute' }` | per-route limit on both run-start routes |
| `MAX_FROZEN_DIFF_BYTES` | 200 KB | refuse a frozen diff larger than this (replayed on every run forever) |
| `DASHBOARD_RECENT_RUNS_LIMIT` / `DASHBOARD_TREND_LIMIT` | 12 / 8 | rows in the recent-runs table / points per dashboard sparkline |
| `DEFAULT_DETAIL_DAYS` | 30 | window of `GET /eval/agents/:id` when `days` is omitted |

## API

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/findings/:id/eval-case` | freeze a triaged finding into a case owned by its review's agent. 201 `{ case, created: true, agent_name }`, or 200 with `created: false` when one exists. 422 `finding_not_triaged`, `finding_has_no_agent`, `no_diff_available`, `frozen_diff_too_large`, `expectation_not_grounded` |
| `GET` / `POST` | `/agents/:id/eval/cases` | list / hand-author (`EvalCaseInput`, same size cap and grounding check) |
| `GET` / `PATCH` / `DELETE` | `/eval/cases/:id` | one case / partial edit re-validated when `input_diff` or `expectation` changes / delete the case row only |
| `POST` | `/agents/:id/eval/runs` | body `{ case_ids? }`. Omitted → `scope: suite` over every case; given → `scope: case` (unknown id → 422). 202 `{ run_id, status, scope, estimate }`. 409 `run_in_flight`, 422 `no_cases`, 422 `provider_not_configured` (resolved before the row is inserted) |
| `GET` | `/agents/:id/eval/runs` | run history, any scope, newest first |
| `GET` | `/eval/runs/:id` | one run; `metrics` null while `running` |
| `POST` | `/eval/runs/all` | `{ confirm: true }` → suite run for every enabled agent with ≥1 case; per agent `run_id` or `refused_reason` |
| `GET` | `/eval/dashboard` | `EvalDashboard`: one row per agent (`cases_total`, `runs_total`, latest completed suite run, trend) sorted active-first, plus the recent suite runs |
| `GET` | `/eval/agents/:id?days=30\|all` | `EvalAgentDetail`: suite runs in the window, chronological trend, `current` / `current_version`, `delta` vs the previous completed suite run, `callout`, `case_outcomes` (latest outcome per existing case across every completed run of any scope) |
| `GET` | `/eval/compare?a=&b=` | `EvalCompare`: ordered older → newer, deltas over the common case ids, `only_in_a/b`, `case_transitions`, prompts from `agent_versions.config_json` (live prompt when the snapshot is missing and the agent is still on that version), LCS `prompt_diff`. 422 `different_owners`, `run_not_completed` |

## Freezing a case

1. Join finding → review → pull request; refuse untriaged or agent-less findings.
2. accepted → `must_find`, dismissed → `must_not_flag`; when both timestamps exist the later one wins.
3. `pr_files.patch` (hunks only) is wrapped by `synthesizeFrozenDiff(path, patch)` so `parseUnifiedDiff` keys the file; size-capped.
4. The expectation is checked with `isExpectationGrounded`: a synthetic `kind: 'finding'` built from it must be kept by `groundFindings` against the frozen diff.
5. Insert; a unique-index race (`23505`) re-reads and returns the existing case.

## Scoring (zero model calls)

- Match: `finding.file === expectation.file` and inclusive line ranges intersect (order-insensitive).
- `must_find` passes on ≥1 match; `must_not_flag` on 0 matches. Only findings kept by the grounding gate are scored; dropped ones count in `grounding_total`.
- `recall` = passed must_find ÷ scored must_find; `precision` = 1 − (matches on must_not_flag cases ÷ all kept findings); `citation_accuracy` = kept ÷ emitted. `null` when a denominator is 0. Errored cases count nowhere; `cost_usd` is `null` when any case's cost is unknown.
- Compare recomputes both runs over their common case ids before taking deltas.

## Execution and observability

`startRun` resolves the LLM, inserts the row and returns; `executeRun` loops
the cases sequentially, scores each, and completes the row (`completed`, or
`errored` with `error_reason` when the loop itself throws). Logs carry counts,
metrics, model and cost only, never diff or finding prose.

## Tests

`server/test/eval-scoring.test.ts` (match rule, per-case pass rules, run
metrics, null denominators, subset recomputation, transitions),
`eval-frozen-input.test.ts`, `eval-prompt-diff.test.ts` (diff + callout),
`eval-service.test.ts` (in-memory repository, stubbed executor: creation paths
and refusals, suite and subset runs, in-flight guard, provider refusal, per-case
error, detail / dashboard / compare, snapshot fallback). `contracts.test.ts`
parses the new `EvalRun` shape.

## Measured demonstration (2026-10-25)

Security Reviewer on `openrouter` / `deepseek/deepseek-v4-flash`, six cases
(four must_find, two must_not_flag): v1 recall 0.50 / precision 1.00 / 4 of 6;
v2 (Retry-After and citation guidance) 0.50 / 1.00 / 4 of 6; v3 (noisy "three
CRITICAL per file") 1.00 / 0.83 / 5 of 6 at 2.3× cost; v4 (v2 promoted back)
0.75 / 1.00 / 5 of 6. The model regularly cites a `+` line one or two numbers
off, which strict intersection records as a miss.
