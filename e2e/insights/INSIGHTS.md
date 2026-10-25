# E2e Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-10-25 — To click a tab or button by its label, use the role locator with an exact name: `["find", "role", "button", "click", "--name", "Evals", "--exact"]`; `["find", "text", "<text>", "click"]` also works when the text is unique on the page. ref: e2e/specs/17-eval-dashboard.flow.json:84

2026-10-25 — `agent-browser check '<css>'` toggles a controlled React checkbox (its `onChange` fires), and `agent-browser eval "<js>"` reads page state back (e.g. a `:checked` count) when a flow needs to assert something `wait --text` cannot see. ref: e2e/specs/17-eval-dashboard.flow.json:1

## What Doesn't Work

2026-10-25 — `agent-browser click "text=Security Reviewer"` fails with "Element not found": `click` takes a CSS selector, an XPath, or a snapshot ref (`@e12`) only — the Playwright-style `text=` prefix is not understood. ref: e2e/specs/17-eval-dashboard.flow.json:67

2026-10-25 — Snapshot refs (`@eN`) are valid only after an `agent-browser snapshot` in the SAME page load, and every new `snapshot` call may renumber them; grabbing a ref from one snapshot and clicking it after a second snapshot (or after `open`) yields "Unknown ref". Take one snapshot, parse the ref, click, done. ref: e2e/run.ts:1

2026-10-25 — A physical `agent-browser click` / `find role button click` on a button BELOW THE FOLD reports "✓ Done" but the React `onClick` never fires (the page keeps "2 selected", no dialog appears), while `agent-browser eval "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Compare').click()"` opens the modal at once. Scroll the target into view first (`eval "window.scrollTo(...)"`) or click through `eval` when a step needs an off-screen control. ref: client/src/app/eval/agents/[agentId]/_components/EvalAgentDetailView/RunHistoryTable.tsx:40

## Codebase Patterns

## Tool & Library Notes

2026-10-25 — The `agent-browser` binary used by `npm test` is the global one under `~/.nvm/versions/node/v22.16.0/bin/` (not in `e2e/node_modules/.bin`), so the nvm PATH export from the toolchain notes is required before `cd e2e && npm test`. ref: e2e/run.ts:34

2026-10-25 — Against the shared dev stack the three PR flows (02/04/05) fail at "Add rate limiting to public API endpoints" because the app lands on whichever repo the browser last selected (3 repos in that DB), not the seeded `acme/payments-api`; this is an environment state, not a regression — the hermetic runner seeds a fresh database. ref: e2e/specs/02-repo-pulls-detail.flow.json:1

## Recurring Errors & Fixes

## Session Notes

2026-10-25 — Added `17-eval-dashboard.flow.json` (Eval Dashboard lists seeded agents, agent editor Evals tab renders; read-only, no LLM call); it passes against the running stack once the role locator is used for the tab. Files: e2e/specs/17-eval-dashboard.flow.json, e2e/CLAUDE.md.

## Open Questions
