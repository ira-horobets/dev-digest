# Multi-Agent Review (SPEC-04) — server

Run a chosen set of agents on one pull request, concurrently, under one parent
`multi_agent_runs` row, and read the result back with per-agent columns and
computed disagreements. This file owns the API, the data model, the read model
and its invariants. The UI half lives in
[`client/specs/multi-agent-review.md`](../../client/specs/multi-agent-review.md).
Design and rejected alternatives: [`../docs/multi-agent-review.md`](../docs/multi-agent-review.md).

Spec: specs/multi-agent-review.md (SPEC-04)

Status: **implemented 2026-10-31**. One migration: `0018_aberrant_zarda.sql`.
Paths are relative to `server/src/`.

## Data model

| Table / column | Role |
|---|---|
| `multi_agent_runs` | existing table (`id`, `workspace_id`, `pr_id`, `ran_at`); now written, one row per started multi-agent run. Nothing about status or totals is stored on it |
| `agent_runs.multi_run_id` | new nullable uuid, FK to `multi_agent_runs.id` `ON DELETE SET NULL`, index `agent_runs_multi_run_id_idx` (migration 0018). Set on every child run, `null` for runs started through `POST /pulls/:id/review` |

Groups and conflicts are never stored (invariant 14); no table was added for
them. Child runs are ordinary `agent_runs` rows with `kind = 'review'`,
`source = 'local'`, `status = 'running'` at creation, so every existing run
route (events, trace, cancel, delete, findings) works on them unchanged.

## API (`modules/multi-agent/routes.ts`)

All routes call `getContext()` first and are scoped to the workspace. Errors use
the standard envelope.

| Route | Body / params | Result |
|---|---|---|
| `POST /pulls/:id/multi-agent-run` | `{ agent_ids: string[] }` | 200 `MultiAgentRunStarted { multi_run_id, pr_id, runs: [{ run_id, agent_id, agent_name }] }`, returned before any model call finishes. 400 `invalid_agent_selection` for fewer than 2 or more than 8 ids, or duplicates; 404 for an unknown PR, an unknown or foreign agent id, or a non-uuid id; 422 for a body that is not `{ agent_ids: string[] }` or a non-uuid `:id`. Rate limit 10 per minute |
| `GET /pulls/:id/multi-agent` | — | the PR's latest `MultiAgentRun` (newest `ran_at`), or 404 when it has none |
| `GET /multi-agent-runs/:id` | — | one `MultiAgentRun`, or 404 (also for another workspace's id) |
| `GET /multi-agent/estimates` | — | `AgentEstimates { concurrency, agents: AgentEstimate[] }` for every agent of the workspace, disabled agents included |

`POST /pulls/:id/review` is unchanged (see `review-flow.md`).

### Contracts (`vendor/shared/contracts/observability.ts`)

| Contract | Fields added or used |
|---|---|
| `MultiAgentRunRequest` | `agent_ids` (shape only; the count rule is in the service because schema failures are 422) |
| `MultiAgentRunStarted` | `multi_run_id`, `pr_id`, `runs: ReviewRunTarget[]` |
| `MultiAgentRun` | `id`, `pr_id`, `pr_number`, `ran_at`, `status` (`running` · `done` · `failed`), `agent_count`, `total_duration_ms`, `total_cost_usd`, `columns`, `conflicts` |
| `AgentColumn` | `run_id`, `agent_id` (nullable: agent deleted), `agent_name` (`'Deleted agent'` fallback), `provider`, `model`, `status` (`done` · `failed` · `running` · `cancelled`), `error`, `verdict`, `score`, `summary`, `duration_ms`, `cost_usd`, `findings[]` (`id`, `severity`, `category`, `title`, `file`, `start_line`, `kind`) |
| `Conflict` | `file`, `line`, `end_line`, `title`, `conflict` (boolean), `takes[]` |
| `ConflictTake` | `agent_id`, `run_id`, `persona`, `verdict` (a severity, `'ignored'`, or `'no_result'`), `note` |
| `AgentEstimate` | `agent_id`, `duration_ms`, `cost_usd` (nullable), `samples` |

The client copy of `observability.ts` is byte-identical.

## Invariants

### Start

1. The agent-id count (2 to 8, `MIN_AGENTS` / `MAX_AGENTS`) and duplicate checks
   run in the service and answer 400, because zod failures answer 422.
   Enforced by `MultiAgentService.start` (`modules/multi-agent/service.ts`).
2. A non-uuid agent id is treated as an unknown agent (404) and never reaches
   Postgres; an agent id from another workspace is also 404. A missing PR is 404.
   No row is created for any rejected request. Enforced by `MultiAgentService.start`
   and `MultiAgentRepository.findAgents` (workspace filter).
3. The parent row and one `agent_runs` row per agent are inserted in one
   transaction, so a request creates all rows or none, with `kind 'review'`,
   `status 'running'`, the agent's `provider` and `model`, and `multi_run_id`.
   Enforced by `MultiAgentRepository.createMultiRun`.
4. Execution is fire-and-forget: `start` calls `runner.executeQueued(...)` with
   `void` and a `.catch` that only logs, then returns. Enforced by
   `MultiAgentService.start`.
5. Two identical requests create two parents; there is no idempotency key.

### Execution

6. At most `MULTI_AGENT_CONCURRENCY` (3) agent runs of one multi-agent run are in
   flight. Jobs past the cap log "Queued — waiting for a free slot" to their own
   run. Enforced by `runPool` and `ReviewRunExecutor.executeRuns`
   (`modules/reviews/run-executor.ts`).
7. The diff is loaded once and the PR intent is ensured once for all runs of the
   request; the pre-work log lines reach every run's trace (review-flow
   invariants 8–10). Enforced by `executeRuns`.
8. A failure or cancel of one agent never stops the others; it is recorded on
   that agent's run only (review-flow invariants 12 and 19). If the diff cannot
   load, every child fails with the shared error. Enforced by `runPool` (never
   rejects) and the `failAll` closure.
9. `executeQueued` reloads the pull, the repo and each agent. A missing PR or repo
   fails every queued run; a missing agent fails that run only (`error` =
   `'Agent not found'`). These failures write no trace. Enforced by
   `ReviewRunExecutor.executeQueued`.
10. A run cancelled while queued never starts (`runBus.isComplete(runId)` is
    checked before each job), and a cancel during the model call is honoured:
    `checkCancelled` throws `RunCancelledError` when the bus is cancelled or
    complete, and the success path re-checks right before `insertReview`.
    The run ends `cancelled` with no review. This also applies to
    `POST /pulls/:id/review` runs. Enforced by `executeRuns` and `runOneAgent`.

### Read model

11. `GET` responses are built on read from the child runs, never stored.
    `status` is `running` while any child runs, `failed` when every child failed
    or was cancelled, else `done`. `total_duration_ms` is the longest child
    `duration_ms`; `total_cost_usd` is the sum of non-null child costs, `null`
    when none is known. Enforced by `aggregateParent` / `buildMultiAgentRun`
    (`modules/multi-agent/helpers.ts`).
12. Children are the parent's `agent_runs` with `kind = 'review'` and the caller's
    `workspace_id`, ordered by agent name then run id. Each column carries its
    newest review (by `created_at`) and that review's findings. `error` is set
    only for `failed` and `cancelled` columns. Enforced by `MultiAgentRepository.load`.
13. Every reader of `agent_runs` added here filters `kind = 'review'`, so brief runs
    never appear as children or in estimates. Enforced by `MultiAgentRepository`.
14. Grouping uses no model and stores nothing; the original findings are unchanged.
    Findings of all columns are sorted by file, start line, end line, column order
    and finding id, then joined into a location while the file matches and the
    start is at most the group's largest end line, or within `LINE_TOLERANCE` (3)
    lines of the previous finding's start. The result does not depend on input
    order. Enforced by `groupLocations`.
15. A location's `line` is its smallest start, `end_line` its largest end, `title`
    the highest-severity finding's title. One agent with several findings in a
    location contributes its highest severity (a tie keeps the first in sort
    order). Enforced by `classify`.
16. `takes` has one entry per column: the severity when the agent flagged the
    location; `'ignored'` when the agent is `done` and did not; `'no_result'`
    when the agent failed, was cancelled or is still running, so such an agent is
    never counted as silent. `conflict` is true when a completed agent is
    `'ignored'` or the flagging agents' severities differ. `ConflictTake.agent_id`
    falls back to the run id for a deleted agent. Enforced by `classify`.
17. Estimates are, per agent, the average `duration_ms`, the average non-null
    `cost_usd` and the sample count over its latest `ESTIMATE_SAMPLE` (10) runs
    with `kind = 'review'` and `status = 'done'`; an agent without a sample has
    `duration_ms: null`, `cost_usd: null`, `samples: 0`. `concurrency` is the
    server cap, so the client does not copy the constant. Enforced by
    `MultiAgentRepository.estimateRows` (window `row_number()`) and `toEstimate`.

## Out of scope

- Worktrees per agent, model-written "why silent" notes, replies, storing groups
  or conflicts, per-run model or prompt overrides, an MCP tool.
- A "cancel all" route; each child is cancelled with `POST /runs/:id/cancel`.
- Retries beyond the engine's own LLM retries; a server restart reaps every
  `running` child as `failed` (review-flow invariant 22), so the parent then
  reads `failed` or `done`.

## Open questions

None.
