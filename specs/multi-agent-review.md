# Spec: Multi-Agent Review
Spec ID: SPEC-04
Status: implemented
Supersedes: —

## Problem and user

A reviewer who wants several perspectives on one pull request (security, performance, architecture, a mentor tone, customer-facing wording) must today start agents one at a time from the PR page's "Run Review" dropdown, or run all enabled agents with no choice. The reviewer cannot pick a subset, cannot see what a run will cost or how long it will take, and cannot compare agents side by side. The agent runs are separate rows with nothing that groups them, so the reviewer reads findings from each run in isolation and cannot tell where agents agree or disagree on the same code. The reviewer notices this when two agents flag the same line with different severities, or one stays silent, and nothing shows it.

Users: the reviewer (primary) and the repo owner who watches cost and time per PR.

Current state, verified in code:
- `POST /pulls/:id/review` accepts `agentId` or `all` only (`RunRequest`) and returns run ids at once. `ReviewRunExecutor.executeRuns` runs the agents one after another, not in parallel.
- `multi_agent_runs` (id, workspace_id, pr_id, ran_at) exists in the schema but nothing reads or writes it and no `agent_runs` row links to it.
- Contracts `MultiAgentRun`, `AgentColumn`, `Conflict` and `ConflictTake` exist in `observability.ts`; the routes named in their comments do not exist.
- No cross-agent grouping heuristic exists. `reduceReviews` in reviewer-core only merges map-reduce chunks inside one agent.
- Finding actions: only accept and dismiss work. `learn` and `reply` are in `FindingActionKind` but the server rejects them.
- "Multi-Agent Review" is not in `NAV`; only i18n keys and a pathname match remain.

## Goals / Non-goals

Goals
- Pick any set of agents on the PR page, or on a Configure run screen, and start them as one multi-agent run.
- Show a time and cost estimate per agent and for the run, based on past runs.
- Run the selected agents concurrently with a bounded cap.
- Group the individual `agent_runs` under one parent `multi_agent_runs` row.
- Show results in Columns mode (live status per agent) and Tabs mode (one agent in detail).
- Show a "Where agents disagree" block per code location, including "did not flag", with a "Show only conflicts" toggle.
- Reuse `LiveLogStream` and the run trace drawer; each column has its own status and "View trace".
- Keep every original finding and its agent attribution; grouping is a computed view only.

Non-goals
- Real git worktrees per agent; agents read the diff, not a working tree.
- A model call to explain why a silent agent did not flag a location.
- Learn and Turn into eval case actions: rendered disabled ("coming soon"); they can be enabled once the eval pipeline merges.
- Reply to author (shown in the design, not requested).
- Merging or deleting findings, or storing grouped findings or conflicts.
- Changes under `ci/` or `agent-runner/`.
- A per-run override of an agent's model, prompt or skills.
- Exposing multi-agent runs as an MCP tool.

## User stories

- US-1: As a reviewer, I want to tick agents in the PR page's Run Review menu, so that I run only the perspectives I need.
- US-2: As a reviewer, I want a Configure run screen with a PR selector, agent cards and an estimate, so that I know time and cost before I start.
- US-3: As a reviewer, I want results in columns with live status per agent, so that I can compare agents while they run.
- US-4: As a reviewer, I want to see where agents disagree on one code location, so that I can focus on contested findings.
- US-5: As a reviewer, I want a Tabs view with full finding detail and Accept and Dismiss, so that I can act on findings from any agent.
- US-6: As a repo owner, I want the agent runs of one request grouped under one parent run with total time and cost, so that I can see what a multi-agent review cost.

## Acceptance criteria (EARS)

Revision note (2026-10-31): the Configure run screen design was revised and implemented; AC-15 to AC-17 were reworded and AC-17a and AC-17b added (layout, placeholder, card styling, client-derived accent colour and icon).

Run API and grouping
- AC-1 (US-6): WHEN a client sends `POST /pulls/:id/multi-agent-run` **(new)** with `agent_ids` (2 to 8 agent ids), the system shall create one `multi_agent_runs` row and one `agent_runs` row per agent with a new nullable `agent_runs.multi_run_id` **(new)** pointing to it, and return `multi_run_id` and `runs[]` (`run_id`, `agent_id`, `agent_name`) before any model call completes.
- AC-2 (US-6): IF `agent_ids` has fewer than 2 or more than 8 ids, contains an unknown agent id for the workspace, or the PR is not in the workspace, THEN the system shall respond with the standard error envelope (400 for count, 404 for unknown agent or PR) and create no rows.
- AC-3 (US-6): The system shall keep `POST /pulls/:id/review` unchanged for single-agent and run-all requests.
- AC-4 (US-3): WHEN a multi-agent run starts, the system shall execute the selected agents concurrently, at most 3 at a time **(constant, configurable)**, loading the diff and deriving the PR intent once for all of them.
- AC-5 (US-3): IF one agent in a multi-agent run fails or is cancelled, THEN the system shall continue the other agents and record the failure on that agent's run only.
- AC-6 (US-6): The system shall compute the parent run's status, `total_duration_ms` and `total_cost_usd` on read from its child runs; `total_duration_ms` is the longest child duration and cost is the sum of known child costs.
- AC-7 (US-6): The system shall expose `GET /pulls/:id/multi-agent` **(new)** returning the latest `MultiAgentRun` for the PR and `GET /multi-agent-runs/:id` **(new)** returning one by id, both workspace-scoped, with `columns` and `conflicts` as in the `MultiAgentRun` contract.

Estimates
- AC-8 (US-2): The system shall expose per-agent estimates **(new route)** with average `duration_ms`, average `cost_usd` and the sample count over the agent's last 10 completed `review` runs (kind `review`, status done).
- AC-9 (US-2): IF an agent has no completed run, THEN the system shall return null estimates for it and the UI shall show "no estimate yet" instead of 0s or $0.
- AC-10 (US-2): WHEN agents are selected, the UI shall show the estimated total time as the longest selected estimate (accounting for the concurrency cap of AC-4) and the total cost as the sum of the selected estimates, and shall show a partial-estimate marker when any selected agent has no estimate.

PR page picker
- AC-11 (US-1): The PR page's Run Review menu shall list every agent with a checkbox, its model and its estimate, a Clear link, a "Run multi-agent review (N)" button and a "Configure agents…" link to the Configure run screen.
- AC-12 (US-1): WHEN the menu opens, the system shall pre-select the agents that are enabled; disabled agents are listed, selectable and marked "disabled".
- AC-13 (US-1): WHILE fewer than 2 agents are selected, the "Run multi-agent review (N)" button shall be disabled, and WHILE exactly 1 is selected a "Run review" action shall start a single-agent run through `POST /pulls/:id/review`.
- AC-14 (US-1): WHEN the reviewer clicks "Run multi-agent review (N)", the UI shall call `POST /pulls/:id/multi-agent-run` and navigate to the results page of the returned `multi_run_id`.

Configure run screen
- AC-15 (US-2): The system shall provide the screen `/repos/[repoId]/multi-agent` **(new)** with a breadcrumb "Multi-Agent Review › Configure run" (the first crumb links to `/repos/:repoId/multi-agent`), the page title "Run a Multi-Agent Review" with a one-sentence subtitle, and its content in one centred narrow column; the column holds step 1 "Pull request" (a selector of the repo's pull requests, open and merged) and step 2 "Agents to run", each with a numbered round badge (1, 2).
- AC-16 (US-2): WHILE no pull request is selected, step 2 shall be muted and show a dashed placeholder with a pull-request icon, the text "Pick a pull request first" and a one-line hint, and the Run button shall be shown but disabled.
- AC-17 (US-2): WHEN a pull request is selected, step 2 shall show a single-column list of full-width agent cards, each with a checkbox, an icon tile, the agent name (with a "disabled" marker when the agent is disabled), the full description wrapping without truncation, and the estimate (duration and cost) at the top right in monospace; the system shall also show a "Select all" action and a footer with the "Run multi-agent review (N)" button (people icon on its left) followed by "≈ <total estimate> · parallel fan-out" in muted monospace.
- AC-17a (US-2): WHEN an agent card is selected, the card shall be outlined and tinted with the agent's accent colour; WHILE it is unselected, the card shall be neutral.
- AC-17b (US-2): The client shall derive each agent's accent colour and icon without a contract or database change: by keyword match on the agent name (security: red shield; performance: amber bolt; test or architecture: green; mentor, customer or general: blue; api or contract: amber), otherwise a stable palette slot chosen from the agent id; colours shall come only from existing CSS variables.
- AC-18 (US-2): IF the selected PR is merged or closed, THEN the screen shall show the existing merged warning and still allow the run.
- AC-19 (US-2): IF the workspace has no agents, THEN the screen shall show an empty state with a link to `/agents`.
- AC-20 (US-2): The system shall add "Multi-Agent Review" to the sidebar `NAV` in `client/src/vendor/ui/nav.ts` **(new)** with the href `/repos/:repoId/multi-agent` (user-approved exception to the `vendor/ui` do-not-touch rule, limited to this one entry), and include any new shared UI piece in `/showcase`.

Results page
- AC-21 (US-3): The system shall provide the results page `/repos/[repoId]/multi-agent/[multiRunId]` **(new)** with a header showing "Configure run", the selected agent count, agent count, total duration, total cost and a Columns / Tabs toggle.
- AC-22 (US-3): The results page shall keep the selected view in the URL (`?view=columns` or `?view=tabs`), defaulting to columns.
- AC-23 (US-3): In Columns mode, the system shall show one column per agent with its status (running, done, failed), score ring, duration, cost, finding cards (severity, title, `file:line`), a "View trace" link and a findings count.
- AC-24 (US-3): WHILE an agent run is running, its column shall stream its run events over `GET /runs/:id/events` into `LiveLogStream` and show a running status; WHEN the stream ends, the column shall refetch and show its result.
- AC-25 (US-3): WHEN the reviewer clicks "View trace" in a column, the system shall open the existing run trace drawer for that column's run.
- AC-26 (US-3): IF a column's run failed or was cancelled, THEN the column shall show the error message and keep its "View trace" link while the other columns remain usable.
- AC-27 (US-3): WHEN the results page loads after a reload, the system shall rebuild every column from the persisted data and reopen event streams only for runs still running.
- AC-28 (US-5): In Tabs mode, the system shall show one tab per agent with its score, an agent summary card (score, verdict text, "View trace", duration, cost) and its findings, expandable to category, `file:line` range, confidence, explanation and suggested fix.
- AC-29 (US-5): WHEN the reviewer clicks Accept or Dismiss on a finding, the system shall call `POST /findings/:id/accept` or `/dismiss` and show the persisted state on the card.
- AC-30 (US-5): The Tabs detail shall show "Learn" and "Turn into eval case" as disabled actions with a "coming soon" tooltip, and shall not show "Reply to author".

Disagreements
- AC-31 (US-4): The system shall group findings of different agents into one location when they have the same file and overlapping line ranges, or ranges starting within 3 lines of each other **(constant, configurable)**, by a deterministic rule with no model call.
- AC-32 (US-4): The system shall keep every original finding with its agent attribution unchanged in the persisted data; groups and conflicts are computed on read and never stored.
- AC-33 (US-4): The system shall classify a location as a conflict when at least one agent flagged it and at least one other completed agent in the same multi-agent run did not, or when the flagging agents assigned different severities.
- AC-34 (US-4): The "Where agents disagree" block shall list each location (`file:line` and topic) with one cell per agent showing its severity, or "did not flag" (`ConflictTake.verdict = 'ignored'`), and for a flagging agent a one-line note taken from the finding title.
- AC-35 (US-4): WHILE the "Show only conflicts" toggle is on, the block shall list only conflicts; the toggle shall default to off.
- AC-36 (US-4): IF an agent in the run failed, was cancelled or is still running, THEN the block shall show "no result" in its cell and not count it as "did not flag".
- AC-37 (US-4): IF the run has a single completed agent, THEN the system shall not show the "Where agents disagree" block.

## Edge cases

- Estimate with no history: AC-9; the footer shows a partial marker (AC-10).
- Double submit of "Run multi-agent review (N)": the button is disabled while the request is pending (refines AC-14); a second request creates a second parent run, never reuses the first.
- Re-run on the same PR: each run creates a new parent; `GET /pulls/:id/multi-agent` returns the latest (AC-7); the PR page links to it.
- Diff load failure: every child run fails with the shared error and each column shows it (refines AC-26).
- Cancel: cancelling one run through `POST /runs/:id/cancel` marks only that column cancelled (refines AC-5). A "Cancel all" action is a suggestion, not a requirement.
- Same agent selected twice: not possible in the UI; the API rejects duplicate ids with 400 (refines AC-2).
- Large diffs or many findings: columns scroll independently; the conflicts list is capped at 200 locations with a "show more" action.
- Rate limit: the route limits to 10 requests per minute like `/review`; the UI shows the standard error toast.
- Postgres or the provider unavailable: the standard error envelope and toast; no partial parent row without children (AC-1 creates all rows or none).
- Zero conflicts: the block shows "Agents agree on every location" and the toggle shows an empty state.
- Narrow screens: Columns mode scrolls horizontally; Tabs mode stays usable by keyboard (arrow keys between tabs).

## Non-functional requirements

- Time to first response of `POST /pulls/:id/multi-agent-run`: under 1 s p95 (rows created, work in background).
- Cost: N selected agents cost N review calls plus at most one intent call for the PR; the UI shows the estimate before the run.
- Concurrency: at most 3 agent runs at once per multi-agent run.
- Accessibility: all controls keyboard reachable; checkboxes have labels; tabs use roving focus; colours come from design tokens (`SEV`, `CAT`, CSS variables), never hard-coded.
- i18n: all new strings are keys in `client/messages/en/`; the stale "p-queue" and "Run all agents" copy in `runs.json` is replaced.
- Security: workspace scoping on every new route and repository method; no secrets read outside `SecretsProvider`.
- Architecture: new server code in a new module `server/src/modules/multi-agent/` (routes, service, repository); `pnpm lint:arch` stays green; reviewer-core stays free of I/O.
- Contracts: changes made in `server/src/vendor/shared` and copied to `client/src/vendor/shared`.

## Inputs and provenance

| Input | Source | Provenance | Owner |
|---|---|---|---|
| Selected agent ids | user, picker or Configure screen | [new] | client |
| Agent list, model, enabled flag | `GET /agents` (`AgentDto`) | [reused: agents module] | server agents |
| PR list and PR status | existing PR list route | [reused: pulls module] | server pulls |
| Per-agent duration and cost estimate | `agent_runs` last 10 completed review runs | [deterministic: averages in code, no model] | server multi-agent **(new)** |
| Parent run and `agent_runs.multi_run_id` | `multi_agent_runs` plus new column | [new] | server multi-agent |
| Run progress | `GET /runs/:id/events` (`RunEvent`) | [reused: reviews routes] | server reviews |
| Findings and verdict per agent | `agent_runs`, reviews, findings tables | [reused: `RunFindings`, `FindingRecord`] | server reviews |
| Location groups and conflicts | computed from persisted findings | [deterministic: overlap rule, no model] | server multi-agent |
| Conflict note for a flagging agent | the finding's `title` | [reused: `FindingRecord.title`] | server multi-agent |
| Trace | `GET /runs/:id/trace` (`RunTrace`) | [reused: trace drawer] | server reviews |
| Concurrency cap, line tolerance, agent limits | constants | [new] | server multi-agent |
| Layout and copy | the five design screenshots | [new: design] | client |

## Untrusted inputs

| Input | Handling rule |
|---|---|
| PR title, body and diff | Shown only as text; passed to agents through the existing delimiter-wrapped prompt (`INJECTION_GUARD`), never interpreted by this feature. |
| LLM finding text (title, rationale, suggestion) | Rendered as plain text or through the existing `Markdown` component; never executed; the conflict note uses the title as text. |
| Cloned files | Not read by this feature. |
| User-supplied ids (`agent_ids`, route ids, `view` query) | Validated by zod route schemas; unknown values rejected or defaulted (`view` falls back to columns). |
| Agent names and summaries | Rendered as text; they come from user-authored agent config. |

## Open questions

No question is blocking; the defaults below were adopted from the suggested answers.
- Learn and Turn into eval case: disabled now (AC-30). Once the eval pipeline merges, enabling them needs new ACs and a route; today no eval module or contract exists in this tree.
- Concurrency cap of 3, line tolerance of 3 and the limit of 8 agents are suggested constants; changing them only changes AC-2, AC-4 and AC-31.
- Suggested, not required: a "Cancel all" action on the results page; navigation from the PR page to the latest multi-agent run.
- Resolved: editing `client/src/vendor/ui/nav.ts` for the sidebar entry (AC-20) was approved by the user as a one-entry exception to the `vendor/ui` do-not-touch rule.
