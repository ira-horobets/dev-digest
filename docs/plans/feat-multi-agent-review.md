# Plan: Multi-Agent Review · branch feat/multi-agent-review

Design-system task: no (one approved entry in `client/src/vendor/ui/nav.ts`, AC-20; nothing else under `vendor/ui/`)
Execution mode: multi-agent
Requirements source: specs/multi-agent-review.md (SPEC-04, approved)

Status: READY. On 2026-10-31 the user accepted every default: Q1 → A (D6), Q2 → A (D2), Q3 → A (D4), Q4 → A (D5). S1 and S2 are declined. S3 is accepted as a hand-off note for the doc-writer. No question is open, and AC-21 needs no spec revision.

## Requirements review

| Id | Requirement (spec's words, shortened) | Verdict | Evidence | Covered by |
|---|---|---|---|---|
| AC-1 | POST `/pulls/:id/multi-agent-run` with 2–8 `agent_ids` creates one `multi_agent_runs` row + one `agent_runs` row per agent with new `multi_run_id`; returns `multi_run_id` + `runs[]` before any model call completes | OK | table exists, unused: `server/src/db/schema/runs.ts:56`; no route: `server/src/modules/reviews/routes.ts:39` | rows 1, 3–4, 8–11 · `multi-agent.it.test.ts` |
| AC-2 | <2 or >8 ids → 400; unknown agent or PR → 404; no rows created | OK, D-note | zod schema failures map to **422**, not 400 (`server/src/app.ts:126-131`), so the count/duplicate check belongs in the service (`AppError(...,400)`), not in the route schema | rows 9–11 · `multi-agent-routes.test.ts`, `multi-agent.it.test.ts` |
| AC-3 | `POST /pulls/:id/review` unchanged | OK | `routes.ts:39-56`; executor default stays sequential (row 5) | row 5 · existing `reviews.it.test.ts` |
| AC-4 | concurrent, max 3 (constant), diff + intent loaded once | OK | today sequential: `run-executor.ts:125` loop; diff/intent once: `run-executor.ts:105,118` | rows 5, 6 · `run-executor-pool.test.ts` |
| AC-5 | one agent fails/cancelled → others continue | OK | isolation already: `run-executor.ts:143-151` | row 5 · `multi-agent.it.test.ts` |
| AC-6 | parent status, `total_duration_ms` (max child), `total_cost_usd` (sum known) computed on read | OK, GAP → D3 | `MultiAgentRun` has no `status` field (`observability.ts:75-85`) | rows 1, 8 · `multi-agent-helpers.test.ts` |
| AC-7 | GET `/pulls/:id/multi-agent` (latest) and GET `/multi-agent-runs/:id`, workspace-scoped, `columns` + `conflicts` | OK, GAP → D3 | `AgentColumn` has no `error` / `cancelled` (`observability.ts:41`), `Conflict` has no conflict flag (`observability.ts:66-71`) | rows 1, 8–11 · `multi-agent.it.test.ts` |
| AC-8 | per-agent estimates route: avg `duration_ms`, avg `cost_usd`, sample count over the last 10 done `review` runs | OK | path not named by the spec → D1; brief runs share `agent_runs` (`server/INSIGHTS.md:42`) so filter `kind='review'` | rows 1, 8–11 · `multi-agent.it.test.ts` |
| AC-9 | no completed run → null estimates; UI shows "no estimate yet" | OK | — | rows 8, 17–18 |
| AC-10 | total time = longest estimate given the cap; cost = sum; partial marker | OK | cap is served by the estimates route (D1), so the client does not copy the constant | rows 17, 22, 24 · `multi-agent-estimate.test.ts` |
| AC-11 | Run Review menu: checkbox per agent, model, estimate, Clear, "Run multi-agent review (N)", "Configure agents…" → Configure screen | OK | `Dropdown` closes on every item click and takes only `DropdownItemDef` (`client/src/vendor/ui/kit/Dropdown.tsx:12-15,101-107`), so the picker needs its own popover in the PR-page folder | row 22 · `RunReviewDropdown.test.tsx` |
| AC-12 | enabled agents pre-selected; disabled agents listed, selectable, marked "disabled" | OK | `RunReviewDropdown.tsx:58` already marks disabled | row 22 |
| AC-13 | <2 selected → button disabled; exactly 1 → "Run review" via `/review` | OK | `useRunReview` `client/src/lib/hooks/reviews.ts:174` | row 22 |
| AC-14 | click → POST multi-agent-run, navigate to results of `multi_run_id` | OK | — | rows 16, 22 |
| AC-15 | `/repos/[repoId]/multi-agent`: step 1 PR selector (open + merged), step 2 agents | OK | `usePulls` `client/src/lib/hooks/core.ts:100` | rows 23–24 · `ConfigureRunView.test.tsx` |
| AC-16 | no PR → "Pick a pull request first", Run disabled | OK | — | row 24 |
| AC-17 | PR selected → card per agent (checkbox, one-line summary, estimate), Select all, footer with total | OK | summary = `Agent.description` (`server/src/vendor/shared/contracts/knowledge.ts:418`) | row 24 |
| AC-18 | merged/closed PR → existing merged warning, run still allowed | OK | `prReview.runReview.mergedWarning` (`client/messages/en/prReview.json:46`) | row 24 |
| AC-19 | no agents → empty state with link to `/agents` | OK | — | row 24 |
| AC-20 | NAV entry "Multi-Agent Review" → `/repos/:repoId/multi-agent` (approved exception); new shared UI pieces in `/showcase` | OK | `activeKeyFor` already maps `/multi-agent` (`client/src/components/app-shell/helpers.ts:28`); shell label exists (`client/messages/en/shell.json:26`) | rows 31, 33 |
| AC-21 | results header: "Configure run", selected agent count, agent count, total duration, total cost, Columns/Tabs toggle | UNCLEAR → Q2 answered A (D2) | "selected agent count, agent count" could be read two ways; the user confirmed D2 | row 27 · `MultiRunView.test.tsx` |
| AC-22 | view in URL `?view=columns|tabs`, default columns | OK | needs `<Suspense>` around `useSearchParams` (`client/INSIGHTS.md` 2026-09-26) | rows 26–27 |
| AC-23 | Columns: per-agent status, score ring, duration, cost, finding cards, View trace, count | OK | `CircularScore` primitive, `RunCostBadge` (`client/src/components/run-cost-badge/`) | rows 28–29 |
| AC-24 | running column streams `/runs/:id/events` into `LiveLogStream`; refetch when stream ends | OK | `useRunEvents` `client/src/lib/hooks/reviews.ts:223`; `LiveLogStream` `client/src/vendor/ui/LiveLogStream.tsx` | rows 16, 29 |
| AC-25 | View trace opens the existing trace drawer | OK, D-note | drawer is private to the PR route (`pulls/[number]/_components/RunTraceDrawer`), so it is promoted to `client/src/components/run-trace-drawer/` | rows 20, 27 |
| AC-26 | failed/cancelled column shows the error, keeps View trace | OK, GAP → D3 | `AgentColumn` lacks `error` and `cancelled` (`observability.ts:41`) | rows 1, 29 |
| AC-27 | reload rebuilds columns from DB, streams only for running runs | OK | — | rows 16, 27, 29 |
| AC-28 | Tabs: tab per agent with score; summary card; findings expandable to category, range, confidence, rationale, fix | OK | reuse `FindingCard` (`pulls/[number]/_components/FindingCard/FindingCard.tsx:26-117`) via promotion; full findings from existing `GET /runs/:id/findings` (`routes.ts:141`) | rows 16, 19, 30 |
| AC-29 | Accept/Dismiss call `/findings/:id/accept|dismiss`, show persisted state | OK | `useFindingAction` `hooks/reviews.ts:190` | rows 16, 30 |
| AC-30 | Learn + Turn into eval case disabled with "coming soon" tooltip; no Reply | OK | no eval module in this tree (`server/src/modules/index.ts:31-47`) | rows 19, 30 |
| AC-31 | group by same file + overlapping ranges or starts within 3 lines, deterministic, no model | OK | nothing exists to reuse; `reduceReviews` is per-agent | row 8 · `multi-agent-helpers.test.ts` |
| AC-32 | originals unchanged; groups/conflicts computed on read, never stored | OK | — | rows 8–9 |
| AC-33 | conflict = flagged by ≥1 and not by ≥1 other completed agent, or differing severities | OK | — | row 8 |
| AC-34 | block lists location (`file:line`, topic), one cell per agent: severity or "did not flag" (`'ignored'`), note = finding title | OK | — | rows 1, 8, 32 |
| AC-35 | "Show only conflicts" toggle, default off | OK, GAP → D3 | needs a per-location `conflict` flag | rows 1, 32 |
| AC-36 | failed/cancelled/running agent → "no result", not "did not flag" | OK, GAP → D3 | `ConflictTake.verdict` has no such value (`observability.ts:56`) | rows 1, 8, 32 |
| AC-37 | single completed agent → no block | OK | — | row 32 |
| EC-1 | estimate with no history: AC-9 + partial marker | OK | — | rows 17–18 |
| EC-2 | double submit: button disabled while pending; a second request creates a second parent | OK | — | rows 22, 24 |
| EC-3 | re-run creates a new parent; GET latest returns it; "the PR page links to it" | CONFLICT → Q3 answered A (D4) | the spec's Open questions call "navigation from the PR page to the latest multi-agent run" "suggested, not required"; the user chose to include the link | rows 16, 22 |
| EC-4 | diff load failure: every child fails with the shared error, each column shows it | OK | `failAll` `run-executor.ts:82-112` | rows 5, 29 |
| EC-5 | cancel one run via `/runs/:id/cancel` → only that column cancelled | GAP → Q4 answered A (D5) | `RunBus.complete` clears the cancel flag (`server/src/platform/sse.ts:79`) right after `cancelRun` sets it (`server/src/modules/reviews/service.ts:97-101`), so `checkCancelled` never fires and success later overwrites `cancelled` with `done`; a queued run that is cancelled still starts | row 5 · `multi-agent.it.test.ts` |
| EC-6 | duplicate ids → 400 | OK | same 422-vs-400 note as AC-2 | rows 9–11 |
| EC-7 | columns scroll on their own; conflicts capped at 200 with "show more" | OK | client-side cap | rows 28, 32 |
| EC-8 | 10 requests/min like `/review`; standard toast | OK | `routes.ts:41`; mutation toasts global (`client/src/lib/providers.tsx`) | rows 6, 11 |
| EC-9 | standard envelope; all rows or none | OK | one transaction in the repository | row 9 |
| EC-10 | zero conflicts → "Agents agree on every location"; toggle shows an empty state | OK | stale copy at `client/messages/en/runs.json:13` | rows 32, 34 |
| EC-11 | narrow: Columns scroll horizontally; Tabs work by keyboard (arrow keys) | OK | kit `Tabs` has no roles or arrow keys (`client/src/vendor/ui/kit/Tabs.tsx:16-53`), so `TabsView` builds its own tablist | rows 28, 30 |
| NFR-1 | POST answers <1 s p95 (rows, then background) | OK | fire-and-forget pattern `service.ts:145` | rows 5, 10 |
| NFR-2 | N review calls + at most one intent call | OK | intent once per request `run-executor.ts:118` | row 5 |
| NFR-3 | ≤3 concurrent agent runs per multi-agent run | OK | — | rows 5–6 |
| NFR-4 | keyboard, labelled checkboxes, roving tabs, token colours | OK | `Checkbox` has a `label` prop (`kit/Checkbox.tsx:5-13`) | rows 22, 24, 28–32 |
| NFR-5 | new strings in `client/messages/en/`; stale "p-queue" / "Run all agents" replaced | OK | `runs.json:129-141` | rows 34–35 |
| NFR-6 | workspace scoping on every route and repository method; secrets only via `SecretsProvider` | OK | — | rows 9–11 |
| NFR-7 | new module `server/src/modules/multi-agent/`; `lint:arch` green; reviewer-core free of I/O | OK, CONFLICT with the worktree boundary → Q1 answered A (D6) | a new module must be registered (`server/src/modules/index.ts:31`), and it can reach the reviews executor only through the container (`no-cross-module`, `server/.dependency-cruiser.cjs:105-110`; `server/INSIGHTS.md:27`) | rows 6–14 |
| NFR-8 | contracts changed in server, copied to client | OK | — | rows 1–2 |

The spec's Open questions are resolved in the spec itself. Only the "navigation from the PR page" note matters here; it was handled as EC-3 / Q3 and answered A.

## Suggestions (optional)

- S1 Add an e2e flow `e2e/specs/NN-multi-agent.flow.json` (picker → results → columns). Why: no flow covers the PR-page Run Review menu today (`git grep "Run Review" e2e` finds nothing), and this feature replaces that menu. If accepted: one new row in `e2e/`, verification gains `--e2e`. Status: declined.
- S2 A "Cancel all" action in the results header, calling `POST /runs/:id/cancel` for each running column. Why: spec Open questions, `specs/multi-agent-review.md:159`. If accepted: row 27 gains a button plus one test. Status: declined.
- S3 After the merge, the doc-writer updates `server/specs/review-flow.md` invariant 11 ("Agents in one request execute sequentially", `server/specs/review-flow.md:77`). It stays true for `/review` but not for multi-agent runs. If accepted: doc-writer scope only. Status: accepted (doc-writer hand-off note, no row).

## Goal & acceptance criteria

All spec criteria are copied verbatim, each with how it is verified. The plan adds TC-1..TC-6.

- [ ] AC-1 WHEN a client sends `POST /pulls/:id/multi-agent-run` **(new)** with `agent_ids` (2 to 8 agent ids), the system shall create one `multi_agent_runs` row and one `agent_runs` row per agent with a new nullable `agent_runs.multi_run_id` **(new)** pointing to it, and return `multi_run_id` and `runs[]` (`run_id`, `agent_id`, `agent_name`) before any model call completes. — verified by `server/test/multi-agent.it.test.ts`
- [ ] AC-2 IF `agent_ids` has fewer than 2 or more than 8 ids, contains an unknown agent id for the workspace, or the PR is not in the workspace, THEN the system shall respond with the standard error envelope (400 for count, 404 for unknown agent or PR) and create no rows. — verified by `server/test/multi-agent-routes.test.ts` (400) + `server/test/multi-agent.it.test.ts` (404, row counts)
- [ ] AC-3 The system shall keep `POST /pulls/:id/review` unchanged for single-agent and run-all requests. — verified by existing `server/test/reviews.it.test.ts` + `run-executor-pool.test.ts` (default concurrency 1 keeps target order)
- [ ] AC-4 WHEN a multi-agent run starts, the system shall execute the selected agents concurrently, at most 3 at a time **(constant, configurable)**, loading the diff and deriving the PR intent once for all of them. — verified by `server/test/run-executor-pool.test.ts` (max in flight = limit) + `multi-agent.it.test.ts` (one `derive_intent`/diff-load line per run trace, one intent row)
- [ ] AC-5 IF one agent in a multi-agent run fails or is cancelled, THEN the system shall continue the other agents and record the failure on that agent's run only. — verified by `server/test/multi-agent.it.test.ts`
- [ ] AC-6 The system shall compute the parent run's status, `total_duration_ms` and `total_cost_usd` on read from its child runs; `total_duration_ms` is the longest child duration and cost is the sum of known child costs. — verified by `server/test/multi-agent-helpers.test.ts`
- [ ] AC-7 The system shall expose `GET /pulls/:id/multi-agent` **(new)** returning the latest `MultiAgentRun` for the PR and `GET /multi-agent-runs/:id` **(new)** returning one by id, both workspace-scoped, with `columns` and `conflicts` as in the `MultiAgentRun` contract. — verified by `server/test/multi-agent.it.test.ts` (incl. other-workspace id → 404)
- [ ] AC-8 The system shall expose per-agent estimates **(new route)** with average `duration_ms`, average `cost_usd` and the sample count over the agent's last 10 completed `review` runs (kind `review`, status done). — verified by `server/test/multi-agent.it.test.ts` (11 done runs + one brief run + one failed run seeded)
- [ ] AC-9 IF an agent has no completed run, THEN the system shall return null estimates for it and the UI shall show "no estimate yet" instead of 0s or $0. — verified by `multi-agent.it.test.ts` + `client/src/components/estimate-label/EstimateLabel.test.tsx`
- [ ] AC-10 WHEN agents are selected, the UI shall show the estimated total time as the longest selected estimate (accounting for the concurrency cap of AC-4) and the total cost as the sum of the selected estimates, and shall show a partial-estimate marker when any selected agent has no estimate. — verified by `client/src/lib/multi-agent-estimate.test.ts` + `ConfigureRunView.test.tsx`
- [ ] AC-11 The PR page's Run Review menu shall list every agent with a checkbox, its model and its estimate, a Clear link, a "Run multi-agent review (N)" button and a "Configure agents…" link to the Configure run screen. — verified by `RunReviewDropdown.test.tsx`
- [ ] AC-12 WHEN the menu opens, the system shall pre-select the agents that are enabled; disabled agents are listed, selectable and marked "disabled". — verified by `RunReviewDropdown.test.tsx`
- [ ] AC-13 WHILE fewer than 2 agents are selected, the "Run multi-agent review (N)" button shall be disabled, and WHILE exactly 1 is selected a "Run review" action shall start a single-agent run through `POST /pulls/:id/review`. — verified by `RunReviewDropdown.test.tsx`
- [ ] AC-14 WHEN the reviewer clicks "Run multi-agent review (N)", the UI shall call `POST /pulls/:id/multi-agent-run` and navigate to the results page of the returned `multi_run_id`. — verified by `RunReviewDropdown.test.tsx`
- [ ] AC-15 The system shall provide the screen `/repos/[repoId]/multi-agent` **(new)** with step 1 "Pull request" (a selector of the repo's pull requests, open and merged) and step 2 "Agents to run". — verified by `ConfigureRunView.test.tsx`
- [ ] AC-16 WHILE no pull request is selected, step 2 shall show the placeholder "Pick a pull request first" and the Run button shall be disabled. — verified by `ConfigureRunView.test.tsx`
- [ ] AC-17 WHEN a pull request is selected, step 2 shall show one card per agent with a checkbox, a one-line summary, the estimate (duration and cost), a "Select all" action, and a footer "Run multi-agent review (N)" with the total estimate. — verified by `ConfigureRunView.test.tsx`
- [ ] AC-18 IF the selected PR is merged or closed, THEN the screen shall show the existing merged warning and still allow the run. — verified by `ConfigureRunView.test.tsx`
- [ ] AC-19 IF the workspace has no agents, THEN the screen shall show an empty state with a link to `/agents`. — verified by `ConfigureRunView.test.tsx`
- [ ] AC-20 The system shall add "Multi-Agent Review" to the sidebar `NAV` in `client/src/vendor/ui/nav.ts` **(new)** with the href `/repos/:repoId/multi-agent` (user-approved exception to the `vendor/ui` do-not-touch rule, limited to this one entry), and include any new shared UI piece in `/showcase`. — verified by `client/src/test/smoke.test.tsx` (showcase mounts) + diff review (one NAV entry)
- [ ] AC-21 The system shall provide the results page `/repos/[repoId]/multi-agent/[multiRunId]` **(new)** with a header showing "Configure run", the selected agent count, agent count, total duration, total cost and a Columns / Tabs toggle. — verified by `MultiRunView.test.tsx`
- [ ] AC-22 The results page shall keep the selected view in the URL (`?view=columns` or `?view=tabs`), defaulting to columns. — verified by `MultiRunView.test.tsx` (missing and invalid `view` → columns)
- [ ] AC-23 In Columns mode, the system shall show one column per agent with its status (running, done, failed), score ring, duration, cost, finding cards (severity, title, `file:line`), a "View trace" link and a findings count. — verified by `MultiRunView.test.tsx`
- [ ] AC-24 WHILE an agent run is running, its column shall stream its run events over `GET /runs/:id/events` into `LiveLogStream` and show a running status; WHEN the stream ends, the column shall refetch and show its result. — verified by `AgentColumn.test.tsx` (mocked `EventSource`)
- [ ] AC-25 WHEN the reviewer clicks "View trace" in a column, the system shall open the existing run trace drawer for that column's run. — verified by `MultiRunView.test.tsx`
- [ ] AC-26 IF a column's run failed or was cancelled, THEN the column shall show the error message and keep its "View trace" link while the other columns remain usable. — verified by `AgentColumn.test.tsx`
- [ ] AC-27 WHEN the results page loads after a reload, the system shall rebuild every column from the persisted data and reopen event streams only for runs still running. — verified by `MultiRunView.test.tsx` (EventSource opened only for `running` columns)
- [ ] AC-28 In Tabs mode, the system shall show one tab per agent with its score, an agent summary card (score, verdict text, "View trace", duration, cost) and its findings, expandable to category, `file:line` range, confidence, explanation and suggested fix. — verified by `TabsView.test.tsx`
- [ ] AC-29 WHEN the reviewer clicks Accept or Dismiss on a finding, the system shall call `POST /findings/:id/accept` or `/dismiss` and show the persisted state on the card. — verified by `TabsView.test.tsx`
- [ ] AC-30 The Tabs detail shall show "Learn" and "Turn into eval case" as disabled actions with a "coming soon" tooltip, and shall not show "Reply to author". — verified by `TabsView.test.tsx`
- [ ] AC-31 The system shall group findings of different agents into one location when they have the same file and overlapping line ranges, or ranges starting within 3 lines of each other **(constant, configurable)**, by a deterministic rule with no model call. — verified by `server/test/multi-agent-helpers.test.ts`
- [ ] AC-32 The system shall keep every original finding with its agent attribution unchanged in the persisted data; groups and conflicts are computed on read and never stored. — verified by `multi-agent.it.test.ts` (findings rows unchanged after two GETs) + schema diff (no new table)
- [ ] AC-33 The system shall classify a location as a conflict when at least one agent flagged it and at least one other completed agent in the same multi-agent run did not, or when the flagging agents assigned different severities. — verified by `multi-agent-helpers.test.ts`
- [ ] AC-34 The "Where agents disagree" block shall list each location (`file:line` and topic) with one cell per agent showing its severity, or "did not flag" (`ConflictTake.verdict = 'ignored'`), and for a flagging agent a one-line note taken from the finding title. — verified by `DisagreementsBlock.test.tsx`
- [ ] AC-35 WHILE the "Show only conflicts" toggle is on, the block shall list only conflicts; the toggle shall default to off. — verified by `DisagreementsBlock.test.tsx`
- [ ] AC-36 IF an agent in the run failed, was cancelled or is still running, THEN the block shall show "no result" in its cell and not count it as "did not flag". — verified by `multi-agent-helpers.test.ts` + `DisagreementsBlock.test.tsx`
- [ ] AC-37 IF the run has a single completed agent, THEN the system shall not show the "Where agents disagree" block. — verified by `DisagreementsBlock.test.tsx`
- [ ] TC-1 `client/src/vendor/shared` is a byte-identical copy of `server/src/vendor/shared` for `contracts/observability.ts`. — verified by `diff server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts` (inside `verify.sh`)
- [ ] TC-2 The migration is generated, not hand-written, and adds only `agent_runs.multi_run_id` (FK → `multi_agent_runs.id` on delete set null) and its index. — verified by `pnpm db:generate` output + `pnpm db:migrate` in `verify.sh --with-it`
- [ ] TC-3 `pnpm lint:arch` is green with no new baseline entry. — verified by `verify.sh run`
- [ ] TC-4 A queued run cancelled before it starts is never started, and a cancelled in-flight run stays `cancelled` (D5). — verified by `multi-agent.it.test.ts`
- [ ] TC-5 Every new `agent_runs` reader filters `kind = 'review'`. — verified by `multi-agent.it.test.ts` (brief run ignored by estimates)
- [ ] TC-6 Moving `FindingCard` and `RunTraceDrawer` into `client/src/components/` leaves the PR page unchanged. — verified by the moved `FindingCard.test.tsx`, `RunTraceDrawer.test.tsx`, `FindingsPanel.test.tsx` staying green

## Out of scope

- Real git worktrees, model-generated "why silent" notes, Reply to author, storing groups or conflicts, per-run model/prompt overrides, MCP tool (spec non-goals).
- Enabling Learn / Turn into eval case (AC-30: disabled only).
- Anything under `ci/`, `agent-runner/` (the staged `agent-runner/` files belong to another worktree and must not be committed from this branch), `e2e/` (S1 declined), `mcp/`, `reviewer-core/`.
- "Cancel all" (S2 declined).
- Any change to `/review` behaviour beyond the cancel fix D5.
- Specs and docs. The doc-writer runs after implementation: `server/specs/review-flow.md` invariant 11, `server/docs/api-contracts.md`, `client/specs/pages.md`, and a new module spec if wanted.

## Relevant INSIGHTS

- `server/INSIGHTS.md:27` — a module gets a sibling module's service from the container and types it structurally in its own `ports.ts` → rows 7, 13
- `server/INSIGHTS.md:42` — brief runs share `agent_runs`; every new reader filters `kind='review'` → row 9 (estimates, children)
- `server/INSIGHTS.md:10` — grep contracts before naming (TS2308 passes vitest). Checked: `MultiAgentRunRequest`, `MultiAgentRunStarted`, `AgentEstimate`, `AgentEstimates` are free → row 1
- `server/INSIGHTS.md:69` — the executor sets status before writing `run_traces`; IT tests wait with `waitForPrRuns` (`server/test/helpers/runs.ts`) → row 15d
- `server/INSIGHTS.md:33` — IT tests that start runs must override secrets, github and `llm.openrouter` → row 15d
- `server/INSIGHTS.md:29` — best-effort pre-work must not go through `runLog.step` (error event → toast); the "queued" log line uses `runLog.info` → row 5
- `client/INSIGHTS.md` (2026-09-26) — importing a runtime value from `@devdigest/shared` breaks Next; client code imports `type` only and mirrors enums locally → rows 16–32
- `client/INSIGHTS.md` (2026-09-26) — a client component that uses `useSearchParams` needs `<Suspense>` in `page.tsx` → rows 23, 26
- `client/INSIGHTS.md` (2026-10-06) — mutation errors already toast globally; do not add a second `role=alert` → rows 22, 24
- `client/INSIGHTS.md` (2026-10-06) — deep relative imports are an ESLint error; remove a file from `LEGACY_DEEP_RELATIVE` when you convert it → row 21
- `client/INSIGHTS.md` (2026-10-20) — breadcrumbs are per page (crumb strings passed to `AppShell`), not derived from NAV → rows 24, 27
- `client/INSIGHTS.md` (2026-09-25 popover) — `overflow: hidden` ancestors clip absolute popovers; anchor `position: fixed` if the header clips → row 22

## Architecture constraints

| Rule / limit | Applies to | How the plan complies |
|---|---|---|
| `no-cross-module` (`.dependency-cruiser.cjs:105`) | multi-agent → reviews executor | `ReviewRunnerPort` (structural) in `multi-agent/ports.ts`; instance from `container.reviewRunner` built in `routes.ts` deps |
| `application-no-container` | `multi-agent/service.ts`, `helpers.ts` | the service takes an explicit `MultiAgentDeps` object; only `routes.ts` reads `app.container` |
| `application-no-row-types` | `multi-agent/service.ts`, `helpers.ts` | the repository returns plain DTO-ish types declared in `ports.ts`; helpers are pure over those |
| `routes-no-persistence`, `drizzle-only-in-driven-ring` | `multi-agent/routes.ts` | Drizzle only in `multi-agent/repository.ts` |
| `reviewer-core-boundary` | multi-agent module | never imports reviewer-core; grouping is plain TS in `helpers.ts` |
| `ports-are-pure` | `multi-agent/ports.ts` | types only; `Logger` declared structurally (pino-compatible), not imported from `run-executor.ts` |
| baseline (`.dependency-cruiser-known-violations.json`) | `reviews/run-executor.ts` already baselined for `type Container` and `db/rows`, `db/schema` | the edit adds no new import edge; new code does not copy those patterns; no baseline regeneration |
| Contracts copy rule (root `AGENTS.md`) | `observability.ts` | edit the server copy, then `cp` it to the client; never hand-edit the client copy |
| Migrations via drizzle-kit only | `agent_runs.multi_run_id` | schema edit → `pnpm db:generate` → commit the SQL + snapshot → `pnpm db:migrate` |
| `vendor/ui` do-not-touch | `nav.ts` | exactly one NAV item (AC-20). No change to `Dropdown`, `Tabs`, `Checkbox` (new behaviour lives in route/components folders) |
| Client placement (react-frontend-architecture) | trace drawer and finding card used by two routes | promoted to `client/src/components/<kebab>/`; route components stay ≤2 `_components` levels deep; data via hooks in `src/lib/hooks/<domain>.ts` |
| AC-3 | `executeRuns` | new `opts.concurrency` defaults to 1, so `/review` stays sequential in target order (review-flow invariant 11) |

## Existing patterns to follow

- New module with ports + deps object → copy `server/src/modules/pr-brief/` (`routes.ts:18-32` deps assembly, `ports.ts:59-125`)
- Container port getter + override → `server/src/platform/container.ts:168-170` (`prBriefRepo`) and `ContainerOverrides` `:84-85`
- Sibling-service getter on the container → `container.ts:208-228`
- Creating `agent_runs` rows in another module's repository → `server/src/modules/pr-brief/repository.ts:createRun`
- Run/finding row → DTO mapping → `server/src/modules/reviews/repository/run.repo.ts:81-132` (`findingsForRun`), `helpers.ts:findingRowToDto`
- Fire-and-forget background run with a logged crash → `server/src/modules/reviews/service.ts:143-147`
- Per-route rate limit → `server/src/modules/reviews/routes.ts:41`
- Route + service unit test with fakes → `server/test/pr-brief-service.test.ts`, `server/test/onboarding-routes.test.ts`
- IT test that runs agents → `server/test/agents-stats.it.test.ts` (buildApp overrides), `server/test/helpers/runs.ts` (`waitForPrRuns`)
- Polling query while running → `client/src/lib/hooks/reviews.ts:43-51` (`usePrRuns`)
- 404 = "none yet", no retry → `client/src/lib/hooks/reviews.ts:87-94` (`usePrIntent`)
- SSE per run + `LiveLogStream` → `RunTraceDrawer.tsx:47,62` + `RunTraceDrawer/helpers.ts:eventsToLog`
- Thin page + view with `useSearchParams` in Suspense → `client/src/app/skills/page.tsx`
- Disabled "not available yet" action with tooltip → `client/src/app/context/_components/ProjectContextView/ProjectContextView.tsx:PLANNED_TOOLS`
- Cross-page component folder + showcase entry → `client/src/components/run-cost-badge/` + `client/src/components/showcase/Showcase.tsx`

## Work breakdown (ordered)

| # | Package | Module / ring | File (new/edit) | Change | Skills to apply | Test |
|---|---|---|---|---|---|---|
| 1 | server | vendor/shared · 0 | `src/vendor/shared/contracts/observability.ts` (edit) | Additive changes only. `AgentColumn`: `agent_id` → nullable, `status` adds `'cancelled'`, new `error: string \| null`. `ConflictTake`: new `run_id`, `verdict` adds `'no_result'`. `Conflict`: new `end_line`, new `conflict: boolean`. `MultiAgentRun`: new `status: 'running' \| 'done' \| 'failed'`. New `MultiAgentRunRequest {agent_ids: string[]}` (shape only; count rule lives in the service, see AC-2), `MultiAgentRunStarted {multi_run_id, pr_id, runs: ReviewRunTarget[]}` (import from `./review-api.js`), `AgentEstimate {agent_id, duration_ms: int\|null, cost_usd: number\|null, samples: int}`, `AgentEstimates {concurrency: int, agents: AgentEstimate[]}`. Update the file header comment to the real routes | zod, typescript-expert | `server/test/contracts.test.ts` (add parse cases) |
| 2 | client | vendor/shared copy | `client/src/vendor/shared/contracts/observability.ts` (copy) | `cp` from row 1, byte-identical (TC-1). No hand edits | — | TC-1 diff |
| 3 | server | db · 3a | `src/db/schema/runs.ts` (edit) | `multiRunId: uuid('multi_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })`, nullable; index `agent_runs_multi_run_id_idx` on it | drizzle-orm-patterns, postgresql-table-design | row 15d |
| 4 | server | db · 3a | `src/db/migrations/0018_<drizzle-name>.sql` + `meta/` (generated) | `cd server && pnpm db:generate`, then `pnpm db:migrate`. Never edit the SQL. Read the output with `Read` (implementer guard: no redirects next to `src/db/migrations`, `server/INSIGHTS.md:57`) | drizzle-orm-patterns | TC-2 |
| 5 | server | reviews · 2 | `src/modules/reviews/run-executor.ts` (edit) | (a) `executeRuns(..., logger?, opts?: { concurrency?: number })`. The `for` loop at `:125` becomes a worker pool via an exported pure `runPool(items, limit, fn)` (limit = `max(1, opts.concurrency ?? 1)`), so `/review` stays sequential. (b) Before starting a job, skip it if `runBus.isComplete(runId)` (cancelled while queued; DB row already `cancelled`). Log "Queued — waiting for a free slot" with `runLog.info` for jobs past the cap. (c) D5: `checkCancelled` also throws when `runBus.isComplete(runId)`, and the success path re-checks right before `insertReview`, so a cancel during the model call ends in the existing cancel branch instead of `done`. (d) New `executeQueued(workspaceId, prId, jobs: {agentId, runId}[], opts: {concurrency, logger?})`: loads pull (`repo.getPull`), repo (`repo.getRepo`), agents (`agents.getById`), fails the affected runs (`completeAgentRun` failed + bus complete) when any is missing, then awaits `executeRuns`. No new import edges | onion-architecture-backend, typescript-expert | `server/test/run-executor-pool.test.ts` (new): max-in-flight ≤ limit, limit 1 keeps order, one rejection does not stop the others; rest in 15d |
| 6 | server | multi-agent · 2 | `src/modules/multi-agent/constants.ts` (new) | `MULTI_AGENT_CONCURRENCY = 3`, `MIN_AGENTS = 2`, `MAX_AGENTS = 8`, `LINE_TOLERANCE = 3`, `ESTIMATE_SAMPLE = 10`, `RATE_LIMIT = { max: 10, timeWindow: '1 minute' }` | onion-architecture-backend | — |
| 7 | server | multi-agent · 1 | `src/modules/multi-agent/ports.ts` (new) | `MultiAgentRepositoryPort` (`getPull`, `findAgents(workspaceId, ids)`, `createMultiRun(workspaceId, prId, agents)` → `{multiRunId, runs}` in one transaction, `getMultiRun(workspaceId, id)`, `latestForPull(workspaceId, prId)`, `estimates(workspaceId, sample)`), plain read types (`ParentRow`, `ChildRun`, `ChildFinding` with `end_line`, `EstimateRow`), `ReviewRunnerPort { executeQueued(...) }`, structural `Logger`, `MultiAgentDeps { repo, runner, concurrency, lineTolerance, logger? }` | onion-architecture-backend, typescript-expert | — |
| 8 | server | multi-agent · 2 | `src/modules/multi-agent/helpers.ts` (new) | Pure: `toColumn(child)` (status `running\|done\|failed\|cancelled`, `error`, agent name fallback for a deleted agent), `aggregateParent(children)` (status: running if any running, failed if all failed/cancelled, else done; duration = max child `duration_ms`; cost = sum of non-null, null if none), `groupLocations(columns, tolerance)` (sort by file, start, end, column order, id; a finding joins the open group when the file matches and `start ≤ group.end` or `start − group.lastStart ≤ tolerance`; the same agent twice in one group → its highest severity and that finding's title), `classify(group, columns)` (takes: severity / `'ignored'` for a completed non-flagger / `'no_result'` for running, failed or cancelled; `conflict` per AC-33; `line` = min start, `end_line` = max end, `title` = highest-severity finding's title), `toEstimate(rows)` (avg duration, avg of non-null cost, samples; nulls when 0) | typescript-expert | `server/test/multi-agent-helpers.test.ts` (new): overlap, within-3, 4-apart split, other file split, determinism under input shuffle, same-agent duplicate, severity divergence, silent completed agent, `no_result` not counted as ignored, all agree → `conflict: false`, parent aggregation (running/failed/done, null costs) |
| 9 | server | multi-agent · 3a | `src/modules/multi-agent/repository.ts` (new) | Drizzle. Every method takes `workspaceId`. `createMultiRun`: one `db.transaction` inserting the parent and N `agent_runs` (status running, source local, kind review, provider/model from the agent, `multiRunId`). `getMultiRun` / `latestForPull` (order `ran_at desc`, limit 1): parent + `pull_requests.number`; children `where multi_run_id = ? and workspace_id = ? and kind = 'review'` left-joined to agents; newest review per child `run_id`; findings by `review_id in (...)`. `estimates`: per workspace agent, the last `sample` runs with `kind='review' and status='done'` (window `row_number() over (partition by agent_id order by ran_at desc)`), avg `duration_ms`, avg `cost_usd`, `count(*)` | drizzle-orm-patterns, postgresql-table-design, security | 15d |
| 10 | server | multi-agent · 2 | `src/modules/multi-agent/service.ts` (new) | `start(workspaceId, prId, agentIds, logger)`: dedupe/count check → `AppError('invalid_agent_selection', …, 400)` for <2, >8 or duplicates; non-UUID ids count as unknown; `repo.getPull` → `NotFoundError`; `repo.findAgents` size mismatch → `NotFoundError('Agent not found')`; then `createMultiRun`; then `void runner.executeQueued(..., { concurrency }).catch(log)`; returns `MultiAgentRunStarted`. `get(workspaceId, id)` / `latest(workspaceId, prId)` → `NotFoundError` when absent; build `MultiAgentRun` via helpers. `estimates(workspaceId)` → `AgentEstimates` incl. `concurrency` | onion-architecture-backend, security | `server/test/multi-agent-service.test.ts` (new, fakes): 400 cases create nothing, 404 cases create nothing, runner called once with cap 3 |
| 11 | server | multi-agent · 3b | `src/modules/multi-agent/routes.ts` (new) | Builds `MultiAgentDeps` from `app.container` (`multiAgentRepo`, `reviewRunner`, constants, `app.log`). `POST /pulls/:id/multi-agent-run` (params `IdParams`, body `MultiAgentRunRequest`, `rateLimit: RATE_LIMIT`, 201 or 200 `MultiAgentRunStarted`), `GET /pulls/:id/multi-agent`, `GET /multi-agent-runs/:id` (response `MultiAgentRun`), `GET /multi-agent/estimates` (response `AgentEstimates`). `getContext()` first in every handler | fastify-best-practices, zod, onion-architecture-backend, security | `server/test/multi-agent-routes.test.ts` (new): 400 for 1 and 9 ids and duplicates, 422 for a non-array body, rate-limit config present |
| 12 | server | root | `src/modules/index.ts` (edit) | Register `multiAgent` (one import + one entry) | onion-architecture-backend | `server/test/routes-smoke.test.ts` |
| 13 | server | root | `src/platform/container.ts` (edit) | `multiAgentRepo` getter + `ContainerOverrides.multiAgentRepo`. Singleton `intentService` getter (same deps as `reviews/routes.ts:27-33`). `reviewRunner` getter returning `new ReviewRunExecutor(this, this.reviewRepo, this.agentsRepo, this.intentService, this.projectContext)` (singleton) | onion-architecture-backend, typescript-expert | covered by 15d |
| 14 | server | reviews · 3b | `src/modules/reviews/routes.ts` (edit, D6) | Replace the local `new IntentService({...})` with `container.intentService`, so the intent deps are composed once. No route change (AC-3) | fastify-best-practices, onion-architecture-backend | `reviews.it.test.ts`, `intent.it.test.ts` |
| 15d | server | test | `server/test/multi-agent.it.test.ts` (new) | buildApp with MockSecrets/MockGitHub/`llm.openrouter` (+ `llm.openai` failing fixture for one agent). Cases: AC-1 rows + linkage + response before completion; AC-2 404s + zero rows; AC-4 one intent row and diff line in every trace; AC-5 one failed child, others done; AC-6/7 latest vs by-id, other-workspace → 404; AC-8/9 estimates (11 done runs → 10 samples, brief + failed ignored, agent with none → nulls); AC-32 findings unchanged; TC-4 cancel queued (4 agents, cap 3, cancel the 4th before it starts → stays `cancelled`, no review row). Use `waitForPrRuns` | drizzle-orm-patterns | itself |
| 16 | client | lib/hooks | `client/src/lib/hooks/multi-agent.ts` (new) + `client/src/lib/hooks/reviews.ts` (edit) | New: `useAgentEstimates()`, `useStartMultiAgentRun()` (mutation → `MultiAgentRunStarted`), `useMultiAgentRun(id)` (polls 4 s while `status==='running'`), `useLatestMultiAgentRun(prId)` (404 → no retry). In `reviews.ts`: `useRunFindings(runId)` for `GET /runs/:id/findings`, and `useFindingAction` also invalidates `["run-findings", …]`. Type-only imports from `@devdigest/shared` | react-best-practices, react-frontend-architecture | `client/src/lib/hooks/multi-agent.test.ts` (new): poll stops when done, 404 not retried |
| 17 | client | lib | `client/src/lib/multi-agent-estimate.ts` (new) + `.test.ts` | Pure: `totalEstimate(selected, estimates, cap)` → `{durationMs \| null, costUsd \| null, partial}`. Duration = makespan of known durations over `cap` slots (longest first, least-loaded slot), cost = sum of known, `partial` when any selected has null | typescript-expert | `multi-agent-estimate.test.ts`: ≤cap → max, 5 agents cap 3, all null → nulls + partial, mixed → partial |
| 18 | client | components | `client/src/components/estimate-label/` (new: `EstimateLabel.tsx`, `index.ts`, `styles.ts`, `EstimateLabel.test.tsx`) | Renders "~1m 20s · $0.012" (`formatCost`) or "no estimate yet"; optional partial marker | react-best-practices, react-frontend-architecture, react-testing-library | itself |
| 19 | client | components | `client/src/components/finding-card/` (move from `app/repos/[repoId]/pulls/[number]/_components/FindingCard/` with `git mv`, edit) | Promote unchanged plus one optional `extraActions?: React.ReactNode` rendered after Accept/Dismiss; convert imports to `@/`; update `FindingsPanel.tsx:11` import | react-best-practices, react-frontend-architecture | moved `FindingCard.test.tsx` + one case for `extraActions` |
| 20 | client | components | `client/src/components/run-trace-drawer/` (move whole `RunTraceDrawer/` folder incl. `_components/` with `git mv`) | Promote unchanged; update `pulls/[number]/page.tsx:17` import; fix relative message paths in the test (`client/INSIGHTS.md` @/ alias note) | react-frontend-architecture | moved `RunTraceDrawer.test.tsx` |
| 21 | client | config | `client/eslint.config.mjs` (edit) | Remove the `FindingCard.tsx` (`:32`) and `RunReviewDropdown.tsx` (`:35`) entries from `LEGACY_DEEP_RELATIVE`; both files now use `@/` | — | `pnpm lint` |
| 22 | client | PR page | `pulls/[number]/_components/RunReviewDropdown/` (edit `RunReviewDropdown.tsx`, `constants.ts`, `styles.ts`, `RunReviewDropdown.test.tsx`; new `helpers.ts`, `_components/AgentPickRow/`) | Replace the `Dropdown` with an own popover (trigger button unchanged, Escape and outside click close, focus moves into the list). Rows: `Checkbox` labelled with the name, model, `EstimateLabel`, "disabled" marker. Preselect enabled agents on open. Clear link. Footer: total (`totalEstimate`), "Run review" when exactly 1 is selected (`useRunReview`, existing `onRunStart/onRunsStarted/onRunSettled` kept), "Run multi-agent review (N)" disabled <2 and while pending → `useStartMultiAgentRun` → `router.push(/repos/{repoId}/multi-agent/{id})`. "Configure agents…" → `/repos/{repoId}/multi-agent?pr={number}`. D4: "Latest multi-agent run" link when `useLatestMultiAgentRun` has data. Merged warning row kept. `repoId`/`number` from `useParams`, so `PrDetailHeader` is untouched | react-best-practices, react-frontend-architecture, react-testing-library | `RunReviewDropdown.test.tsx`: AC-11..14, EC-2, D4 |
| 23 | client | route | `client/src/app/repos/[repoId]/multi-agent/page.tsx` (new) | Thin; `<Suspense>` around `ConfigureRunView` | next-best-practices, react-frontend-architecture | smoke via 24 |
| 24 | client | route | `multi-agent/_components/ConfigureRunView/` (new: view, `helpers.ts`, `styles.ts`, `index.ts`, test; no `constants.ts`: amended 2026-10-31, the screen has no constants of its own), `multi-agent/_components/PrSelectStep/`, `multi-agent/_components/AgentSelectStep/` (new) | AppShell crumb (repo · "Multi-Agent Review"). Step 1: `SearchableSelect`/`SelectInput` over `usePulls(repoId)` filtered to open + merged, preselected from `?pr=` (written with `router.replace`). Step 2: placeholder without a PR, agent cards (checkbox, `description`, `EstimateLabel`), Select all, footer with total + partial marker + "Run multi-agent review (N)" (disabled <2, no PR or pending). Merged warning for merged/closed. Empty state → `/agents` when `useAgents()` is empty | react-best-practices, react-frontend-architecture, next-best-practices, react-testing-library | `ConfigureRunView.test.tsx`: AC-15..19, AC-10 footer |
| 26 | client | route | `client/src/app/repos/[repoId]/multi-agent/[multiRunId]/page.tsx` (new) | Thin; `<Suspense>` around `MultiRunView` | next-best-practices | via 27 |
| 27 | client | route | `[multiRunId]/_components/MultiRunView/` + `[multiRunId]/_components/RunHeader/` (new) | `useMultiAgentRun(id)`. `view` from `?view=` (invalid → columns, `router.replace` on toggle). Header: "Configure run" link (`/repos/{repoId}/multi-agent?pr={pr_number}`), counts (D2: "{N} agents · {done}/{N} done"), total duration, total cost (`RunCostBadge`), toggle. Holds `traceRunId` state → `RunTraceDrawer` from `@/components/run-trace-drawer` (`running` when the column runs). Loading, error (404 → empty state), crumb | react-best-practices, react-frontend-architecture, react-testing-library | `MultiRunView.test.tsx`: AC-21, 22, 25, 27 |
| 28 | client | route | `[multiRunId]/_components/ColumnsView/` (new) | Horizontal scroll row of `AgentColumn`s (EC-11), each scrolling on its own (EC-7), then `DisagreementsBlock` | react-best-practices | via 27 |
| 29 | client | route | `[multiRunId]/_components/AgentColumn/` (new, with test) | Status pill (running/done/failed/cancelled), `CircularScore`, duration, `RunCostBadge`, finding cards (`SeverityBadge`, title, `file:line`), count, "View trace". While running: `useRunEvents([runId])` → `eventsToLog` → `LiveLogStream`; when `running` flips false → invalidate the multi-run query. Failed/cancelled: error text + View trace | react-best-practices, react-testing-library | `AgentColumn.test.tsx`: AC-24, 26 |
| 30 | client | route | `[multiRunId]/_components/TabsView/` + `[multiRunId]/_components/AgentSummaryCard/` (new, test) | Own tablist (`role=tablist/tab`, `aria-selected`, roving `tabIndex`, Left/Right/Home/End), tab label = name + score. Summary card (score, verdict text, View trace, duration, cost). Findings via `useRunFindings(runId)` → `FindingCard` with `onAction` → `useFindingAction` and `extraActions` = two disabled `Button`s "Learn" / "Turn into eval case" in a `span title="Coming soon"`; no Reply | react-best-practices, react-frontend-architecture, react-testing-library | `TabsView.test.tsx`: AC-28..30, arrow keys |
| 31 | client | vendor/ui (approved) | `client/src/vendor/ui/nav.ts` (edit) | One item in WORKSPACE: `{ key: "multi-agent", label: "Multi-Agent Review", icon: <existing IconName, e.g. "Cpu">, href: "/repos/:repoId/multi-agent" }`. Nothing else (no shortcut). The implementer hook blocks shell writes near `client/src/vendor`; use the Write/Edit tool (`client/INSIGHTS.md` 2026-10-19) | react-frontend-architecture | `app-shell/helpers.test.ts` still green |
| 32 | client | route | `[multiRunId]/_components/DisagreementsBlock/` (new, test) | Hidden when ≤1 column is `done` (AC-37). Toggle "Show only conflicts" (`Toggle`, default off). Rows: `file:line`, topic, one cell per column: `SeverityBadge` + note, "did not flag", or "no result". First 200 rows + "Show more" (EC-7). Zero conflicts → "Agents agree on every location"; toggle on with none → empty state (EC-10) | react-best-practices, react-testing-library | `DisagreementsBlock.test.tsx`: AC-34..37, EC-7, EC-10 |
| 33 | client | components | `client/src/components/showcase/Showcase.tsx` (+ `constants.ts` if fixtures go there) (edit) | Add groups for `EstimateLabel` (value, null, partial) and the promoted `FindingCard` (with the disabled `extraActions`). `RunTraceDrawer` needs live hooks and stays out of the gallery | react-frontend-architecture | `client/src/test/smoke.test.tsx` |
| 34 | client | i18n | `client/messages/en/runs.json` (edit) | Rewrite `page.*` (drop "p-queue", "Run all agents", "every enabled agent in parallel"). Add `configure.*` (steps, placeholder, select all, footer, partial, empty), `results.*` (header, counts, view toggle, status labels, no result, error), `conflicts.empty` → "Agents agree on every location", `conflicts.noResult`, `conflicts.onlyEmpty`, `conflicts.showMore`, `tabs.learn`, `tabs.evalCase`, `tabs.comingSoon`, `estimate.none` ("no estimate yet") | — | through component tests |
| 35 | client | i18n | `client/messages/en/prReview.json` (edit) | `runReview.*`: picker keys (clear, runMulti with `{count}`, runSingle, disabled, latestRun, total, partial). Remove `runAll` only if nothing else uses it (`git grep runReview.runAll`) | — | through `RunReviewDropdown.test.tsx` |
| 36 | client | lib | `client/src/lib/format-duration.ts` (new) + `.test.ts` | Pure duration formatter ("~1m 20s") used by `EstimateLabel` (row 18), `AgentColumn`, `AgentSummaryCard` and `RunHeader` (rows 27–30). Added in fix round 1 (plan amendment) | react-best-practices | `format-duration.test.ts` |
| 37 | client | test | `client/src/test/multi-agent-fixtures.ts` (new) | Shared `MultiAgentRun` / estimate fixtures for the multi-agent component tests. Added in fix round 1 (plan amendment) | react-testing-library | used by rows 24–32 tests |
| 38 | server | test | `server/test/helpers/multi-agent.ts` (new) | Shared fixtures for the multi-agent unit tests (`multi-agent-helpers`, `-routes`, `-service`.test.ts), next to `helpers/runs.ts`. Added in fix round 1 (plan amendment) | — | rows 8, 10, 11 tests |

Numbers follow build order: server first, then client from shared pieces to pages. Row 25 is intentionally unused so the cross-references above stay stable. Row 15d is the server integration test.

## Contracts & migrations

- Contract changes: `AgentColumn`, `ConflictTake`, `Conflict`, `MultiAgentRun` (additive fields and enum values); new `MultiAgentRunRequest`, `MultiAgentRunStarted`, `AgentEstimate`, `AgentEstimates` in `contracts/observability.ts` (already re-exported by the barrel). Copied to `client/src/vendor/shared` in row 2. Names were grepped: no collision.
- Migration: `agent_runs.multi_run_id uuid null references multi_agent_runs(id) on delete set null` + index, via `pnpm db:generate` (expected `0018_*`). No change to `multi_agent_runs`.

## Verification plan

| Package | Commands | Needs Docker |
|---|---|---|
| all touched | `bash .claude/skills/pr-self-review/scripts/verify.sh run --with-it`, then `verify.sh check` | yes |
| server (while building rows 3–4) | `cd server && pnpm db:generate && pnpm db:migrate` | yes |
| server (row 5) | `cd server && pnpm exec vitest run run-executor-pool` | no |
| server (rows 8–11) | `cd server && pnpm exec vitest run multi-agent-helpers multi-agent-service multi-agent-routes` · `pnpm lint:arch` | no |
| server (row 15d) | `cd server && pnpm exec vitest run multi-agent.it.test` then `reviews.it.test` (AC-3); rerun a single file before blaming a flake (`server/INSIGHTS.md:68`) | yes |
| client (rows 16–35) | `cd client && pnpm exec vitest run RunReviewDropdown ConfigureRunView MultiRunView AgentColumn TabsView DisagreementsBlock EstimateLabel multi-agent-estimate smoke` (filter by file name, not by a `[repoId]` path: `client/INSIGHTS.md` 2026-10-12) | no |

`--e2e` is not needed (S1 declined).

## Risks & open questions

Every question is resolved. The user accepted all defaults on 2026-10-31:
- Q1 → A: the files beyond the stated boundary are allowed (D6): `server/src/modules/index.ts`, `server/src/platform/container.ts`, the one-line `server/src/modules/reviews/routes.ts` change, `client/eslint.config.mjs`, `client/src/lib/hooks/{multi-agent,reviews}.ts`, `client/src/lib/multi-agent-estimate.ts`, `client/src/components/{estimate-label,finding-card,run-trace-drawer}/`, the showcase and `prReview.json`.
- Q2 → A: AC-21 header = "{N} agents · {done}/{N} done" (D2). No spec revision is needed.
- Q3 → A: the PR-page picker links to the latest multi-agent run (D4).
- Q4 → A: the cancel race is fixed in `run-executor.ts` (D5). This also fixes `/review` cancels: a cancelled run is no longer overwritten to `done`.

Remaining risks (not questions):
- `ReviewRunExecutor` now has two owners (the reviews route's `ReviewService` and `container.reviewRunner`). Both are stateless apart from the shared `runBus`, so this is safe. Do not put per-request state on the executor.
- `RunLogger` fan-out under concurrency. Pre-work events go to all N runs, and per-run events go through `forRun` (`run-executor.ts:170`). Interleaving across runs is expected and harmless, because each run's trace is built from its own bus buffer.
- Provider rate limits with 3 parallel calls on one key. Failures are isolated per run (AC-5). There is no retry change.
- The IT suite is flaky under parallel load (`server/INSIGHTS.md:68-69`). The new IT test must use `waitForPrRuns`.
- Pre-existing, not fixed here: boot reaps every `running` row (`server/INSIGHTS.md:7`), so a server restart mid-run fails every child. The parent then reads as `failed` or `done`, which is correct.

## Decisions taken by default

- D1 Estimates route = `GET /multi-agent/estimates` returning `AgentEstimates { concurrency, agents[] }` for every workspace agent (disabled agents included). The client reads the cap from it (AC-10) instead of copying the constant.
- D2 (Q2, confirmed by the user) Results header shows "{agent_count} agents" for the run's selected agents, and "{done}/{agent_count} done" as progress, next to total duration and cost.
- D3 Additive contract fields: `MultiAgentRun.status`, `AgentColumn.error` + `'cancelled'` + nullable `agent_id`, `ConflictTake.run_id` + `'no_result'`, `Conflict.conflict` + `end_line`. They are needed by AC-6, AC-26, AC-35 and AC-36. No consumer exists yet (`git grep AgentColumn client/src` finds only the contract copy).
- D4 (Q3, confirmed by the user) EC-3 wins over the Open questions note: the PR-page picker shows a "Latest multi-agent run" link when `GET /pulls/:id/multi-agent` returns one.
- D5 (Q4, confirmed by the user) Cancel race fixed in `run-executor.ts`: queued runs cancelled before start are skipped, and `checkCancelled` also honours `runBus.isComplete`.
- D6 (Q1, confirmed by the user) The extra files listed under Q1 are in scope. `reviews/routes.ts` gets the one-line `container.intentService` swap rather than a second copy of the intent composition in the container.
- D7 AC-2 count, duplicate and range checks run in the service (400 `AppError`), because route-schema failures are 422 (`server/src/app.ts:127`). Non-UUID ids are treated as unknown agents (404), never sent to Postgres.
- D8 Grouping tie-breaks (AC-31): sort by file, start, end, column order, finding id. The same agent twice in one group → its highest severity and that finding's title. Location `line` = min start, `title` = highest-severity title. Locations come back in sorted order.
- D9 The Tabs detail reuses `FindingCard` (promoted) and loads full findings from the existing `GET /runs/:id/findings`, so `AgentColumnFinding` stays small.

## Handoff

- Architecture review focus: `server/src/modules/multi-agent/*` rings and the deps object; the container getters (`reviewRunner`, `intentService`, `multiAgentRepo`) and that no new cruiser edge or baseline entry appears; the `run-executor.ts` pool keeping `/review` sequential (AC-3); client placement of the promoted `finding-card` / `run-trace-drawer`, route `_components` depth ≤2, the single `nav.ts` entry, and no other `vendor/ui` edit.
- Security review focus: workspace scoping in every `multi-agent/repository.ts` query (parent, children, reviews, findings, estimates) and on `GET /multi-agent-runs/:id`; `agent_ids` handling (non-UUID, duplicates, cross-workspace agent ids → 404, no rows); the rate limit on POST; LLM finding text rendered as text/Markdown only (conflict note = title as text); the `view` query defaulting safely.
- plan-verifier: AC-1/2/5/7/8 and TC-4/5 via `multi-agent.it.test.ts`; AC-3 via `reviews.it.test.ts`; AC-4 via `run-executor-pool.test.ts`; AC-31/33/36 via `multi-agent-helpers.test.ts`; TC-1 contract diff; TC-2 migration generated (drizzle name, snapshot present); AC-20 exactly one NAV diff hunk.
- doc-writer (after implementation): `server/specs/review-flow.md` invariant 11 (S3), `server/docs/api-contracts.md` (four new routes), `client/specs/pages.md` (two new routes, `?view=`, `?pr=`), and spec status → implemented through `spec-creator`.

## Plan amended (fix round 1, 2026-10-31)

- Row 24: `ConfigureRunView/constants.ts` dropped; the component has no constants of its own.
- Rows 36–38 added for helper files the implementer created: `client/src/lib/format-duration.ts` (+ test), `client/src/test/multi-agent-fixtures.ts`, `server/test/helpers/multi-agent.ts`.
- `specs/README.md` index line for SPEC-04 is kept: spec-creator wrote it with the spec, before implementation; it is not implementation scope creep.
- Verification note: `verify.sh` cannot run in an emdash git worktree (`.git` is a file); the implementer's manual package checks stand in for it.
