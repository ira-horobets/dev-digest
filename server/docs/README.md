# server — docs

Design notes for this package: how a subsystem works, why it was built this
way, and what alternatives were rejected. One Markdown file per topic.

Repo-wide docs (e.g. agent-prompt guidance) live in `../../docs/`.

What goes where:

- `README.md` (package root) — overview, diagrams, commands.
- `docs/` (here) — deeper design notes and decisions.
- `specs/` — feature specs written before or alongside a change.
- `INSIGHTS.md` — short non-obvious learnings and gotchas.

## Index

- [`architecture.md`](architecture.md) — boot sequence, DI `Container` and overrides, the routes/service/repository trio, `JobRunner`, SSE `RunBus` + `RunLogger`, secrets, the Drizzle schema and migrations, and how `reviewer-core` is consumed through a path alias.
- [`pr-brief.md`](pr-brief.md) — PR Brief: generate flow (sequence), data flow of the inputs into the one call, verification of model references (flowcharts), and the decisions: brief runs as `agent_runs` rows with a `kind`, one-transaction completion, no `reviewer-core` change, deadline outside the adapter, computed staleness.
- [`multi-agent-review.md`](multi-agent-review.md) — Multi-Agent Review: start/run sequence and read-model flowchart, and the decisions: container-owned `reviewRunner` instead of a cross-module import, child runs as plain `agent_runs`, a pool with default concurrency 1, the 400 rule in the service, everything derived computed on read, rule-based grouping, `no_result` vs `ignored`, the cancel-race fix.
- [`export-to-ci.md`](export-to-ci.md) — Export to CI: end-to-end sequence (export → GitHub PR → workflow run → artifact → refresh ingest), ingest flowchart, ER diagram, and the decisions: pull instead of push, one branch and one commit, config hash for "out of date", untrusted artifact limits, `ciRepo` container getter, committed runner bundle.
- [`project-context.md`](project-context.md) — Project context: listing and run-resolution flows (sequence + flowchart), why documents are read from the object database at the PR base branch, adapter-side glob matching, the container-owned singleton with its per-sha cache, token caps and the unspaced-run guard, conditional injection-guard wording, local overrides of documents (save sequence, merge outside the cache, token memo, reset rules).
