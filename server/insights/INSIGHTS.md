# Server Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-10-25 — `drizzle-kit generate --name <slug>` needs no database (it diffs `src/db/schema.ts` against `migrations/meta/*_snapshot.json`), and running it BEFORE editing the schema is a free cleanliness probe: "No schema changes, nothing to migrate" proves the snapshot matches the code so the next migration will contain only your change. ref: server/drizzle.config.ts:9

2026-10-25 — Eval scoring is pure code with no model judge: a finding counts when `file` matches AND the line ranges intersect (the same rule `groundFindings` applies to hunks), so recall / precision / citation_accuracy are deterministic for a fixed case set and comparable across agent versions. ref: server/src/modules/eval/scoring.ts:26

2026-10-25 — Background work in a service (`void this.executeRun(...)`) is unit-testable with `vi.waitFor(() => expect(repo.runs[0].status).toBe('completed'))`; to test the "run already in flight" guard, hand the service an executor whose `runCase` awaits a deferred promise you release after the assertion — an instantly-resolving stub completes the first run before the second start is checked. ref: server/test/eval-service.test.ts:300

## What Doesn't Work

2026-10-25 — Dropping and adding columns on the SAME table in ONE `drizzle-kit generate` makes drizzle-kit ask "created or renamed?" interactively, which hangs or mis-answers under the Bash tool (no TTY). Generate in two passes: pass 1 keeps the legacy columns and only ADDs (`0010_eval_suite_runs.sql`), pass 2 only DROPs (`0011_eval_drop_per_case_columns.sql`). ref: server/src/db/migrations/0011_eval_drop_per_case_columns.sql:1

2026-10-25 — Agents inserted straight into `agents` by the seed (`db.insert(t.agents)`) have NO `agent_versions` row for version 1 (only `AgentsRepository.insert/update` snapshot), so any feature that reads a version's config (eval compare's system-prompt diff) gets `undefined` for v1. The seed now writes the v1 snapshot and `EvalService.promptForVersion` falls back to the live prompt only while the agent still sits on that version. ref: server/src/modules/eval/service.ts:560

## Codebase Patterns

2026-10-25 — `eval_runs` is ONE ROW PER RUN (owner + `scope` `suite|case` + `agent_version` + `case_ids` + `per_case` jsonb + set-level metrics), not one row per case execution as the reserved L00 shape was; `eval_cases.expected_output` keeps its reserved column name but holds the `EvalExpectation` object the DTO calls `expectation`. Both tables were at zero rows, which is what made the in-place reshape safe. ref: server/src/db/schema/eval.ts:61

2026-10-25 — Only `scope: 'suite'` runs feed the dashboard, trend, deltas, callout and compare; a per-case run from the editor is stored with `scope: 'case'` and only updates that case's "last outcome". Mixing the two would make the trend non-comparable (different case sets). ref: server/src/modules/eval/service.ts:470

2026-10-25 — A module that needs agents only declares a local structural port (`AgentLookup`: `getById/list/getVersion`) satisfied by `container.agentsRepo`, and resolves the LLM through `(p) => container.llm(p)` bound in `routes.ts`; this keeps `service.ts` free of `src/db` imports and lets unit tests pass plain objects. ref: server/src/modules/eval/ports.ts:33

## Tool & Library Notes

2026-10-25 — The local Postgres had 18 applied migrations while this branch's `_journal.json` lists 10: other feature branches migrated the same database. The drizzle migrator applies every journal entry whose `when` exceeds the last applied `created_at`, so a freshly generated migration still applies, but a table another branch already changed will collide — check `\d <table>` before reshaping one. ref: server/src/db/migrate.ts:32

2026-10-25 — The `pr_files.patch` column stores hunks only (no `diff --git` / `---` / `+++` header); `parseUnifiedDiff` keys files off the `+++ b/<path>` line, so a stored patch must be wrapped by `synthesizeFrozenDiff(path, patch)` before parsing or it yields zero files. ref: server/src/modules/eval/frozen-input.ts:18

## Recurring Errors & Fixes

2026-10-25 — `deepseek/deepseek-v4-flash` frequently cites a `+` line one or two numbers off its real new-side line (e.g. 13 for a key on 12, 45-46 for a 429 on 48). Under strict range intersection such a finding is a MISS even though the issue was found; citation accuracy stays 100% because the cited line is still inside the hunk. Widen an expectation's range to the whole added block when the exact line is not the point. ref: server/src/modules/eval/scoring.ts:33

## Session Notes

2026-10-25 — Built the L06 Eval Pipeline (cases from triaged findings, background suite runs, code-only scoring, dashboard/detail/compare APIs) and ran the prompt-sensitivity experiment on the Security Reviewer: v1 recall 0.5/precision 1.0 → v2 (+Retry-After guidance) 0.5/1.0 → v3 deliberately noisy 1.0/0.83 at 2.3× cost → v4 (v2 restored) 0.75/1.0. Files: server/src/modules/eval/*, server/src/db/schema/eval.ts, server/src/db/migrations/0010_*.sql, 0011_*.sql, server/test/eval-*.test.ts, server/src/db/seed.ts.

## Open Questions

2026-10-25 — Precision only counts a finding as a false positive when it intersects a `must_not_flag` expectation's range (the spec's literal `1 − FP/total`); noisy findings elsewhere in a must_not_flag case (e.g. three CRITICALs at line 23 for an expectation on line 21) are invisible to precision. Should a must_not_flag case treat ANY kept finding in its file as a FP? Investigated in: server/src/modules/eval/scoring.ts:120.
