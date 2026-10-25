# Eval Pipeline — client

The UI of the regression harness: a "Turn into eval case" action on triaged
findings, an Evals tab in the agent editor, the Eval Dashboard page and a
per-agent detail page with a two-run compare modal. The API half is
[`server/specs/eval-pipeline.md`](../../server/specs/eval-pipeline.md).

Spec: specs/eval-pipeline.md (SPEC-04)

Status: **implemented 2026-10-25**.

## Turn into eval case (`FindingCard`, `FindingsPanel`)

`FindingCardAction = FindingActionKind | "turnIntoEvalCase"` is threaded
through the existing `onAction` prop; the shared enum is not widened. The
button (icon `FlaskConical`) renders only while the finding is accepted or
dismissed. `FindingsPanel` branches on the value and calls
`useCreateEvalCaseFromFinding`; the toast says "created" or "already exists"
with the case name and agent, errors show the server message.

## Data (`src/lib/hooks/eval.ts`, `src/lib/eval-format.ts`)

| Hook | Endpoint |
|---|---|
| `useEvalCases(agentId)` / `useEvalCase(id)` | `GET /agents/:id/eval/cases`, `GET /eval/cases/:id` |
| `useCreateEvalCaseFromFinding()` | `POST /findings/:id/eval-case` |
| `useCreateEvalCase()` / `useUpdateEvalCase()` / `useDeleteEvalCase()` | `POST /agents/:id/eval/cases`, `PATCH` / `DELETE /eval/cases/:id` |
| `useStartEvalRun()` | `POST /agents/:id/eval/runs` (`caseIds` optional → single-case run) |
| `useEvalRun(runId)` | `GET /eval/runs/:id`, polls every 3 s only while `running`, then invalidates cases / runs / detail / dashboard |
| `useEvalRuns(agentId)` | `GET /agents/:id/eval/runs`, polls while any run is running |
| `useRunAllEvals()` | `POST /eval/runs/all { confirm: true }` |
| `useEvalDashboard()` / `useEvalAgentDetail(agentId, days)` / `useEvalCompare(a, b)` | the three read routes |

Every mutation invalidates through `invalidateAgentReads(agentId)`. Formatters:
`formatPct` (null → the translated "n/a"), `formatDeltaPts`, `formatCost`
(four decimals below one cent), `formatRanAt`, `formatDuration`,
`formatVersion`. The expectation editor validates against the shared Zod
`EvalExpectation` imported from `@devdigest/shared/contracts/knowledge`
(a deep path: value imports through the barrel break the Next bundle).

## Agent editor Evals tab (`/agents/[id]?tab=evals`, `EvalsTab/`)

- `MetricTiles`: recall, precision, citation accuracy (`+N pt` / `−N pt` deltas vs the previous completed suite run) and traces passed; "n/a" without a run.
- Header: "View full dashboard →" (`/eval/agents/:id`), "N / M passing" badge, Run all evals (disabled while a run is in flight or there are no cases), New eval case.
- `CaseRow`: status glyph (check / cross / warning / clock), mono name, "expected N findings, got M" / "never run" / "errored: reason", expectation badge ("CRITICAL · security" or "empty []"), Run / Edit / Delete (`window.confirm`).
- `CaseEditorModal`: Name; Input tabs Diff / Files / PR meta (+ Notes); Expected output JSON with a live "valid JSON" / "invalid JSON" badge, "Finding skeleton", hint; last-run box (passed / failed / errored / never run with duration and cost); footer "Run on save" toggle, Cancel, Run case (edit mode), Save. Create and update go through the hooks above; a 422 message is shown inline.
- An `aria-live` region announces "Running…".

## Eval Dashboard (`/eval`, `EvalDashboardView/`)

Sidebar: SKILLS LAB → Eval Dashboard (`nav.ts`, shortcut `g e`; `shell.nav.eval`
already existed). Header with "Run all agents" (loading while any recent run is
running). `AgentSummaryRow` per agent: icon, name, model badge, "Last run vN ·
date · passed/total pass" or "No eval cases yet · never run", recall
`Sparkline` when ≥2 points, RECALL / PREC / CITE values, chevron → the detail
page. `RecentRunsTable`: agent, date, version, three `MetricBar`s, pass count;
running / errored rows show a status cell. `RunAllModal` states the agent and
execution counts, then lists per-agent started / refused.

## Agent detail (`/eval/agents/[agentId]`, `EvalAgentDetailView/`)

Back link, title + model badge, "Regression harness · N runs on the M-case gold
set", agent switcher `Dropdown`, range `Dropdown` (7 / 30 / 90 days / all; client
state passed as `?days=`), Run eval. `CalloutBanner` renders the structured
callout from `eval.json` ("Recall dipped 25pts on v4 — 2 changed outcome: …").
Three `MetricCard`s with sparklines and fractional deltas. `TrendChart`: the
`@devdigest/ui` `LineChart` with a hand-rendered legend and an sr-only table
twin; hidden below two points. `RunHistoryTable`: native checkboxes (max two,
completed runs only), "N selected", Compare enabled at two.

`CompareModal` (`GET /eval/compare`): title "Compare runs · vA → vB", four
tiles (recall, precision, citation, cost) as `old → new` + signed delta, the
case-set change note, "Cases that changed outcome", the prompt diff (removed
lines red strike-through, added green, plain text nodes) with a v-old / v-new
legend, and Close / "Promote vB" → `useUpdateAgent` with `prompt_b` as
`system_prompt`; disabled as "vB is the current prompt" when equal.

## States

| Surface | Loading | Empty | Error |
|---|---|---|---|
| Evals tab | skeleton rows | "No eval cases yet" with the Turn-into-eval-case hint; tiles "n/a" | server message in the modal / toast |
| Dashboard | skeleton rows | "No agents yet" with a CTA to `/agents`; "No eval runs yet…" table empty state | full-screen `ErrorState` with Retry |
| Detail | skeletons | "No runs in this window."; trend hint below two runs | full-screen `ErrorState` with Retry |
| Compare | skeleton | "The system prompt is identical…" / "No prompt snapshot is available…" | inline `ErrorState` |

## Strings and tests

`messages/en/eval.json` (rewritten: `metrics`, `status`, `expectation`,
`dashboard`, `runAll`, `detail`, `callout`, `compare`, `evalsTab`,
`caseEditor`) and `prReview.finding.{turnIntoEvalCase,evalCaseCreated,evalCaseExists,evalCaseFailed}`.

Tests: `EvalsTab.test.tsx` (empty state, tiles + deltas + passing badge + row
outcomes, suite / single-case run calls, editor with skeleton validation,
in-flight disabling), `EvalDashboardView.test.tsx` (rows, recent runs, run-all
estimate), `CompareModal.test.tsx` (deltas, transitions, prompt diff, Promote
call and the disabled state), `FindingCard.test.tsx` (action gated on triage).
E2e: `17-eval-dashboard.flow.json`.
