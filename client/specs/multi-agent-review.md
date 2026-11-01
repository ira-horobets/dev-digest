# Multi-Agent Review (SPEC-04) — client

Pick a set of agents on the PR page or on a Configure run screen, start them as
one multi-agent run, and compare the results as columns or tabs with a "Where
agents disagree" block. This file owns the screens, their URL state, states and
hooks. The API half lives in
[`server/specs/multi-agent-review.md`](../../server/specs/multi-agent-review.md).
Paths are relative to `client/`.

Spec: specs/multi-agent-review.md (SPEC-04)

Status: **implemented 2026-10-31**.

## Surfaces

| Surface | File | Purpose |
|---|---|---|
| PR page Run Review menu | `src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/` | own popover (not the kit `Dropdown`, which closes on every item click) with an agent picker |
| `/repos/[repoId]/multi-agent` | `src/app/repos/[repoId]/multi-agent/_components/ConfigureRunView/` (+ `PrSelectStep`, `AgentSelectStep`) | Configure run: step 1 pull request, step 2 agents |
| `/repos/[repoId]/multi-agent/[multiRunId]` | `.../[multiRunId]/_components/MultiRunView/` (+ `RunHeader`, `ColumnsView`, `AgentColumn`, `TabsView`, `AgentSummaryCard`, `DisagreementsBlock`) | results |
| Sidebar | `src/vendor/ui/nav.ts` | one WORKSPACE item "Multi-Agent Review" (`Users` icon) → `/repos/:repoId/multi-agent`; the only `vendor/ui` edit (approved exception) |
| Shared pieces | `src/components/estimate-label/`, `src/components/finding-card/` (promoted from the PR page, plus an optional `extraActions` slot), `src/components/run-trace-drawer/` (promoted), `src/lib/multi-agent-estimate.ts`, `src/lib/format-duration.ts`, `src/lib/agent-accent.ts` | `EstimateLabel` and `FindingCard` are in `/showcase` |

## Hooks (`src/lib/hooks/multi-agent.ts`, `reviews.ts`)

| Hook | Endpoint | Notes |
|---|---|---|
| `useAgentEstimates` | `GET /multi-agent/estimates` | also supplies the concurrency cap |
| `useStartMultiAgentRun` | `POST /pulls/:id/multi-agent-run` | invalidates `["pr-runs", prId]` and `["multi-agent-latest", prId]` |
| `useMultiAgentRun(id)` | `GET /multi-agent-runs/:id` | polls every 4 s while `status === "running"`; a 404 is not retried |
| `useLatestMultiAgentRun(prId)` | `GET /pulls/:id/multi-agent` | a 404 means "none yet", not retried |
| `useRunFindings(runId)` | `GET /runs/:id/findings` | full findings for the Tabs view |
| `useFindingAction` | `POST /findings/:id/accept\|dismiss` | also invalidates `["run-findings", …]` |

## Estimate rule (`totalEstimate`)

Selected agents' durations are scheduled longest first onto `min(cap, known)`
slots, each onto the least loaded slot; the total time is the largest slot. Cost
is the sum of the known costs. `partial` is true when any selected agent has no
estimate for duration or cost. With no known value the total is `null`.
`EstimateLabel` shows "no estimate yet" for a null estimate and a partial marker
when asked.

## Run Review menu

1. The trigger button is unchanged. Opening the menu resets the selection to
   every **enabled** agent; disabled agents are listed, selectable and marked
   "disabled". Each row: a labelled `Checkbox`, the model and the estimate.
2. Header link "Clear" empties the selection. Escape and a click outside close
   the menu; focus moves to the first checkbox on open.
3. Footer: the total estimate; "Run review" when exactly one agent is selected
   (`useRunReview`, `POST /pulls/:id/review`, with the existing `onRunStart`,
   `onRunsStarted`, `onRunSettled` callbacks); "Run multi-agent review (N)",
   disabled below 2 agents and while a request is pending, which calls
   `useStartMultiAgentRun` and goes to `/repos/{repoId}/multi-agent/{multi_run_id}`.
4. "Configure agents…" goes to `/repos/{repoId}/multi-agent?pr={number}`. A
   "Latest multi-agent run" link to the PR's latest run appears when
   `useLatestMultiAgentRun` returns one (the query runs only while the menu is open).
5. The merged/closed warning row stays. Without agents the list shows the
   "Configure agents…" text.

## `/repos/[repoId]/multi-agent` (Configure run)

- URL: `?pr=<number>` selects the pull request (`router.replace`). The page wraps
  `ConfigureRunView` in `Suspense` (`useSearchParams`). Crumb: "Multi-Agent
  Review" (links to `/repos/{repoId}/multi-agent`) · "Configure run". Title "Run a
  Multi-Agent Review"; the whole page sits in one centred narrow column.
- Steps carry a numbered round badge (`StepHeading`); step 2 is muted until a PR
  is picked.
- Step 1 "Pull request": a selector over `usePulls(repoId)` limited to open and
  merged PRs (closed-unmerged PRs are not offered, but a `?pr=` that names one
  still resolves).
- Step 2 "Agents to run": without a PR, a dashed placeholder (PR icon, "Pick a
  pull request first", one-line hint) and a disabled Run button. With a PR: a
  single-column list of full-width cards, each a `role="checkbox"` button named
  after the agent (checkbox, icon tile, name, full wrapped description, estimate
  top-right in monospace). A selected card is outlined and tinted with the
  agent's accent from `src/lib/agent-accent.ts`: keyword match on the name, else a
  stable palette slot from the id, CSS variables only (there is no purple token).
  "Select all", then the footer: "Run multi-agent review (N)" with a people icon
  (disabled below 2 agents, without a PR, or while pending) followed by
  "≈ <total estimate> · parallel fan-out" with the partial marker. Enabled agents
  are preselected until the user changes the list.
- A merged or closed PR shows the merged warning and the run is still allowed.
- No agents: an empty state with a link to `/agents`.
- Unknown repo: `RepoNotFound`. Run: `useStartMultiAgentRun`, then push to the
  results page. Errors surface through the global mutation toast.

## `/repos/[repoId]/multi-agent/[multiRunId]` (results)

- URL: `?view=columns|tabs`, default and fallback `columns` (a missing or invalid
  value is columns), written with `router.replace`. Wrapped in `Suspense`.
  Crumb: repo · "Multi-Agent Review" · `#<pr_number>`.
- States: skeleton while loading; 404 → empty state "not found"; other errors →
  `ErrorState` with retry; unknown repo → `RepoNotFound`.
- Header (`RunHeader`): "Configure run" link (`/repos/{repoId}/multi-agent?pr={pr_number}`),
  "{N} agents" and "{done}/{N} done" (`done` counts columns with status `done`),
  total duration (`…` while the run is running), total cost (`RunCostBadge`),
  Columns / Tabs toggle (`aria-pressed`).
- **Columns** (`ColumnsView`, `AgentColumn`): horizontal scroll row, each column
  scrolls on its own. A column shows the status pill (running, done, failed,
  cancelled), score ring, duration, cost, finding rows (severity, title,
  `file:line`), the findings count and "View trace". A `running` column streams
  `GET /runs/:id/events` into `LiveLogStream` (`useRunEvents`) and, when the stream
  ends, invalidates the multi-run query. A failed or cancelled column shows the
  error in a `role="alert"` box and keeps "View trace". Streams open only for
  columns that are `running`, so a reload rebuilds every column from the
  persisted data.
- **Tabs** (`TabsView`, `AgentSummaryCard`): an own tablist (`role="tablist"`,
  `aria-selected`, roving `tabIndex`; Left, Right, Home and End move between
  tabs), one tab per agent labelled with its name and score. The panel has the
  summary card (score, verdict text, "View trace", duration, cost) and the full
  findings from `useRunFindings` as `FindingCard`s (category, range, confidence,
  rationale, suggested fix) with Accept and Dismiss through `useFindingAction`
  (the persisted state is shown). `extraActions` adds "Learn" and "Turn into eval
  case" as disabled buttons with the title "Coming soon"; there is no Reply.
- **View trace** opens the promoted `RunTraceDrawer` for that column's run, held
  in component state (`running` while the column is running).
- **Where agents disagree** (`DisagreementsBlock`): hidden when fewer than two
  columns are `done`. A table with one row per location (`file:line` range, topic)
  and one cell per agent: severity badge and note (the finding title, plain text),
  "did not flag" for `ignored`, "no result" for `no_result`. The "Show only
  conflicts" toggle is off by default. The first 200 rows show, "Show more" adds
  200. No conflict at all shows "Agents agree on every location"; the toggle on with
  no conflict shows an empty note.
- Strings: `messages/en/runs.json` (`page`, `configure`, `results`, `status`,
  `column`, `tabs`, `conflicts`, `estimate`, `viewTrace`) and
  `messages/en/prReview.json` (`runReview` picker keys).

## Tests

`RunReviewDropdown.test.tsx`, `ConfigureRunView.test.tsx`, `MultiRunView.test.tsx`,
`AgentColumn.test.tsx`, `TabsView.test.tsx`, `DisagreementsBlock.test.tsx`,
`EstimateLabel.test.tsx`, `multi-agent-estimate.test.ts`, `format-duration.test.ts`,
`hooks/multi-agent.test.ts`, plus the moved `FindingCard`, `RunTraceDrawer` tests
and the showcase smoke test. No e2e flow covers these screens yet.
