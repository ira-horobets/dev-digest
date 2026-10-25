# Client Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-10-25 — Background server jobs without SSE: `useQuery` with `refetchInterval: (q) => q.state.data?.status === "running" ? 3000 : false` polls only while a run is in flight, and the `queryFn` itself invalidates the dependent reads (cases / runs / agent detail / dashboard) the first time it sees a settled status — no component has to orchestrate the refresh. ref: client/src/lib/hooks/eval.ts:118

2026-10-25 — Hook-mocked component tests: declare mutable fixture state with `vi.hoisted(() => ({...}))`, return it from `vi.mock("…/lib/hooks/eval", …)` factories, and mock `next/navigation` with `{ useRouter: () => ({ push }) }`; `AppShell` can be mocked to a passthrough so page-level views render without the repo context. ref: client/src/app/eval/_components/EvalDashboardView/EvalDashboardView.test.tsx:7

## What Doesn't Work

2026-10-25 — Importing a VALUE (a Zod schema) from the `@devdigest/shared` barrel breaks the Next dev bundle at runtime with `Module not found: Can't resolve './contracts/findings.js'` (HTTP 500 on every page that transitively imports it) because `vendor/shared/index.ts` re-exports with `.js` suffixes webpack does not map to `.ts`. `tsc` and vitest both pass, so the failure only shows in the browser. Type-only imports through the barrel are erased and fine; for runtime values use the deep path `@devdigest/shared/contracts/knowledge`. ref: client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts:5

## Codebase Patterns

2026-10-25 — `client/src/vendor/shared/` is a COPY of `server/src/vendor/shared/`, not a symlink (and `diff -rq` already shows pre-existing drift in `adapters.ts`, `knowledge.ts`, `eval-ci.ts`, `productionize.ts`, `trace.ts`). Any contract change must be applied to both trees; the client typecheck will not notice a server-only edit. ref: client/src/vendor/shared/contracts/eval-ci.ts:1

2026-10-25 — A finding-card action that hits a different route than `POST /findings/:id/:action` (e.g. "Turn into eval case") is modelled as `FindingCardAction = FindingActionKind | "turnIntoEvalCase"` on the component, NOT by widening the shared `FindingActionKind` enum; `FindingsPanel` branches on it and calls its own mutation. ref: client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:28

2026-10-25 — Sidebar nav items live in `vendor/ui/nav.ts` (`NAV` groups also drive the command palette and `g <key>` shortcuts); the `shell.nav.<key>` label must exist in `messages/en/shell.json` and `activeKeyFor` in `components/app-shell/helpers.ts` must map the pathname, or the item renders but never highlights. ref: client/src/vendor/ui/nav.ts:25

## Tool & Library Notes

2026-10-25 — `@devdigest/ui` `LineChart` has no legend or data-point hover; render the legend yourself and keep an `sr-only` table twin of the series for a non-graphical equivalent. `MetricCard` already renders label / big value / signed delta / sparkline, which matches the design's KPI tiles. ref: client/src/app/eval/agents/[agentId]/_components/EvalAgentDetailView/TrendChart.tsx:19

## Recurring Errors & Fixes

## Session Notes

2026-10-25 — Added the L06 eval surfaces: Evals tab in the agent editor (tiles, case list, case editor modal with live-validated expectation JSON), `/eval` dashboard, `/eval/agents/:id` detail with callout/trend/compare modal (Promote = PUT system_prompt), "Turn into eval case" on triaged findings, SKILLS LAB nav group → 30 client tests green. Files: client/src/lib/hooks/eval.ts, client/src/lib/eval-format.ts, client/messages/en/eval.json, client/src/app/eval/**, client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/**.

## Open Questions
