# Agents

Project subagents for DevDigest. This is a map; each agent's file holds its
full instructions, report format and rules. New or edited agents load at the
next session start (or after `/agents`).

## Pipeline

```
researcher (haiku, brief mode) ─► .pipeline/<slug>/brief.md
                                          │
              brainstorm (optional, when the approach is open) ─► .pipeline/<slug>/brainstorm.md
                                          │                      (user picks a variant)
planner ─► docs/plans/<slug>.md ─► implementer ─► verify.sh run ─► test-writer (optional coverage pass)
           (written by planner)        ▲          (once; result +       │
                                       │           diff packs reused)   ▼
                                       │ fix loop (resume the same implementer)
                                       └── architecture-reviewer ∥ security-reviewer ∥ plan-verifier
                                                         │ all pass   (read verify.sh check + packs)
                                                         ▼
                                           doc-writer ─► pr-self-review ─► you commit

Every report lands in .pipeline/<slug>/<agent>.md (git-ignored); agents hand back
at most 15–20 lines. researcher, brainstorm, architecture-reviewer,
security-reviewer and plan-verifier write no files: they return the report after
---REPORT--- and the main session saves it.
```

## Agents

| Agent | Responsibility | Model | Permissions | Input | Output | Sources |
|---|---|---|---|---|---|---|
| [`researcher`](researcher.md) | Answer a concrete question with evidence: repository research, external research, or both; or write the codebase brief the planner starts from | sonnet (brief mode: run with `model: haiku`) | Read-only. `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`; `Bash` limited to one read-only git command; no `Write` | A concrete question (otherwise returns clarifying questions), or "brief for `<slug>`" + the task | Research report or ≤120-line fact brief; with a slug, a ≤15-line hand-back, then `---REPORT---` and the report, which the main session saves to `.pipeline/<slug>/` | — |
| [`brainstorm`](brainstorm.md) | Compare 2–4 genuinely different implementation variants grounded in the repo (constraints, INSIGHTS, existing code), sketch each, one comparison matrix, a recommendation and when the runner-up wins; never plans files or writes code | opus | Read-only. `Read`, `Grep`, `Glob`, `Skill`, `WebSearch`, `WebFetch`; `Bash` limited to one read-only git command; no `Write` | A concrete problem, optionally the brief path and constraints (otherwise returns clarifying questions) | ≤15-line hand-back (variants, recommendation, open questions), then `---REPORT---` + report; the main session saves it to `.pipeline/<slug>/brainstorm.md` for the planner | [F](#f-brainstorm) |
| [`planner`](planner.md) | Turn a task into a file-level plan bound to modules, onion rings, skills, INSIGHTS entries and architecture limits | opus | Read-only. `Read`, `Grep`, `Glob`, `Skill`; `Write` only `docs/plans/<kebab>.md`; `Bash` limited to read-only git and `insight.sh module\|list\|sections\|check`. Loads the architecture skill of each package in play | A concrete task, optionally the brief and brainstorm paths (otherwise returns clarifying questions) | Plan written to `docs/plans/<branch with / → ->.md` + ≤15-line hand-back | [A](#a-planner-and-implementer) |
| [`implementer`](implementer.md) | Execute the plan across packages with the skills each row names, run package checks, prove every acceptance criterion | sonnet | `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `Skill`. No commit/push/PR, no web, no sub-agents; protected paths blocked by hooks | Path to a plan in `docs/plans/` | Code changes + one `verify.sh run` + report in `.pipeline/<slug>/implementer.md` + ≤20-line hand-back | [A](#a-planner-and-implementer) |
| [`test-writer`](test-writer.md) | Fresh-context coverage pass: find the test kinds still missing for the plan and add them; never change source | sonnet | `Edit`/`Write` on test paths only; `Bash` for package tests, no shell writes, dependency or `db:*` changes, `-u`, `--fix`, commits. Loads skills per package (`react-testing-library`, onion di-and-testing, `fastify-best-practices`, `zod`) | Plan path + implementer report, or a concrete target | New/extended test files + `verify.sh run` + report in `.pipeline/<slug>/test-writer.md` + hand-back | [B](#b-test-writer) |
| [`architecture-reviewer`](architecture-reviewer.md) | Verify architecture boundaries of the change set: `lint:arch` + baseline, contract copy, do-not-touch, onion rules the cruiser can't see, client placement and import direction | sonnet | Read-only. `Read`, `Grep`, `Glob`, `Skill`; no `Write`; `Bash` allowlist (`arch`, incl. `verify.sh check\|show`). Loads the architecture skill of each lane present | `verify.sh` result + diff packs, optional plan path | ≤20-line hand-back (verdict, findings one line each), then `---REPORT---` + report and `---FINDINGS---` + JSON; the main session saves both to `.pipeline/<slug>/` | [C](#c-architecture-reviewer) |
| [`security-reviewer`](security-reviewer.md) | Find exploitable problems only: trace each attacker-controlled source (HTTP input, GitHub PR content, LLM output, cloned files) to a sink, check the controls, write the exploit; grade exploit severity (CRITICAL/HIGH/MEDIUM/LOW), confidence and gate severity (critical/warning/info); vulnerable dependencies via read-only audits | opus | Read-only. `Read`, `Grep`, `Glob`, `Skill`; no `Write`; `Bash` allowlist (`security`: `verify.sh check\|show`, change-set scripts, read-only git, `pnpm\|npm audit` without `--fix`). Loads the `security` skill; never runs an exploit, a request or the app | `verify.sh` result + diff packs, optional plan path; or paths/module for an audit | ≤20-line hand-back (verdict, findings with all three grades), then `---REPORT---` + report and `---FINDINGS---` + JSON; the main session saves both to `.pipeline/<slug>/` | [G](#g-security-reviewer) |
| [`plan-verifier`](plan-verifier.md) | Check the working tree against every item of the plan and nothing else; no suggestions | haiku | Read-only. `Read`, `Grep`, `Glob`, no `Skill`; no `Write`; `Bash` allowlist (`verify`: adds package typecheck/lint/test for a single targeted re-run) | Plan path; `verify.sh` result + routing pack; implementer and test-writer reports as claims | ≤20-line hand-back, then `---REPORT---` + report and `---FINDINGS---` + JSON; the main session saves both to `.pipeline/<slug>/` | [D](#d-plan-verifier) |
| [`doc-writer`](doc-writer.md) | Document the implemented, verified feature in the right place (specs, docs with Mermaid, READMEs, index lines) | sonnet | `Edit`/`Write` on documentation `.md` only; `Bash` read-only (reuses `planner-readonly.sh`). Preloads `mermaid-diagram` | Plan path + plan-verifier PASS | Documentation files + report in `.pipeline/<slug>/doc-writer.md` + hand-back | [E](#e-doc-writer) |

None of the agents can spawn sub-agents or ask the user directly (Claude Code
removes `AskUserQuestion` from subagents); questions come back in the output
and the main session relays them.

## Guard hooks

Declared in each agent's frontmatter and active only while that agent runs.
Scripts live in [`../hooks/`](../hooks/); run their tests with
`bash .claude/hooks/tests/run.sh [case-file…]` (cases in `../hooks/tests/cases/*.tsv`).

| Hook | Agent | Enforces |
|---|---|---|
| `researcher-git-readonly.sh [agent]` | researcher, brainstorm (`brainstorm` arg names it in messages); delegated from planner and the reviewers | One plain `git log\|blame\|show\|diff\|shortlog\|grep\|ls-files\|rev-parse`; no operators, `-c`, or file-writing flags |
| `planner-readonly.sh` | planner, doc-writer; delegated from the reviewers | Read-only git (delegates to the above) or `insight.sh` read subcommands |
| `implementer-protected-paths.sh` | implementer | Edits refused on root `AGENTS.md` "Do not touch" paths, `.claude/`, `INSIGHTS.md`, `docs/plans/`, the lint:arch baseline, `.env*`; `client/src/vendor/ui/` only with `Design-system task: yes` in the plan; paths normalised (`..`) |
| `implementer-bash-guard.sh` | implementer; delegated from test-writer | No git writes/history rewrites, no `gh`, no `docker compose down`, no baseline regeneration; no shell writes into protected paths; client contracts change only via `cp` from the server copy |
| `test-writer-paths.sh` | test-writer | Allowlist: `client/src/**/*.test.ts(x)`, `client/src/test/`, `server/test/`, `reviewer-core/test/`, `e2e/specs/NN-kebab.flow.json`, `e2e/specs/flows.md`, `e2e/README.md`; paths normalised |
| `test-writer-bash-guard.sh` | test-writer | Implementer guard, plus: no shell file writes, no dependency changes (`npm ci` / `--frozen-lockfile` only), no `db:*`, no `-u`/`--fix`; `insight.sh` only as a lone command |
| `reviewer-bash-allowlist.sh arch\|verify\|security` | architecture-reviewer (`arch`), plan-verifier (`verify`), security-reviewer (`security`: adds `pnpm -C server\|client audit [--prod]`, `npm --prefix reviewer-core\|e2e audit [--omit=dev]`) | Strict allowlist: `pnpm -C server lint:arch`, `check-arch.sh [--all]`, `changed-files.sh base\|list\|diff`, `route.sh`; `verify` adds package typecheck/lint/test. One optional `PATH=<nvm node22>/bin:$PATH` prefix, no chaining; the rest goes to `planner-readonly.sh` |
| `report-paths.sh planner` | planner | `Write` only `docs/plans/<kebab>.md`; paths normalised. Refuses researcher, brainstorm, architecture-reviewer, security-reviewer and plan-verifier outright (they have no `Write` since 2026-10-07; the test cases keep their old report paths as BLOCK rows) |
| `doc-writer-paths.sh` | doc-writer | Allowlist: `.md` under `<pkg>/docs/`, `<pkg>/specs/`, package and module READMEs, root `README.md` and `docs/` (not `docs/plans/`, `docs/skills/examples/`); never `AGENTS.md`, `CLAUDE.md`, `INSIGHTS.md`, `TESTING.md`, `e2e/specs/` |

The project-wide hooks in `../settings.json` (`pr-self-review` push gate,
`engineering-insights` stop nudge) still apply on top.

## Orchestration rules for the main session (token budget)

Measured on the intent-layer run (2026-10-06): planner 238k tokens on opus (hit
its 40-turn limit), implementer 327k, plan-verifier 128k, architecture-reviewer
107k, test-writer 52k. Most of it was repeated checks and repeated exploration.
The rules below remove the repetition without dropping a check.

1. **Checks run once.** The implementer (or test-writer) ends with `verify.sh run [--with-it] [--e2e]`. Reviewers, the plan-verifier and the main session run `verify.sh check` and re-run nothing that is fresh. Markdown edits (INSIGHTS, plans, reports) keep the result fresh; any code change makes it stale.
2. **The diff is built once.** `verify.sh run` writes `.git/pr-self-review/routing.json` and `lanes/<package>.diff`. Reviewers read those and open whole files only when a hunk is not enough.
3. **Brief, then plan.** For a task that needs repo exploration, run `researcher` with `model: haiku` and "brief for `<slug>`" first. Pass the brief path to the planner.
4. **Files, not messages.** The planner writes the plan file; the implementer, test-writer and doc-writer write their reports to `.pipeline/<slug>/`. The read-only agents (researcher, brainstorm, architecture-reviewer, security-reviewer, plan-verifier) write nothing: the main session saves everything after `---REPORT---` to `.pipeline/<slug>/<agent>.md` and the `---FINDINGS---` JSON to `<agent>.findings.json`, without echoing it to the user. Every agent hands back ≤20 lines. Open a report only to show findings to the user; merge `*.findings.json` with `precheck.json` via `jq`.
5. **Resume for fix rounds.** Send review fixes, including small test-only fixes, to the implementer that built the feature (`SendMessage` resumes it with its cached context). A fresh agent re-reads everything. Use `test-writer` for designing new tests, not for a three-line fix.
6. **Fewer skill loads.**
   - Plans keep `security` / `typescript-expert` only on rows that need them; the review applies both everywhere.
   - The implementer loads each skill once per session.
   - The reviewers and the planner load only the architecture skill of the packages present.
7. **Rules over reviewers.** A boundary finding that recurs becomes a cruiser or ESLint rule, so `verify.sh` catches it instead of a model, e.g. `db-not-to-modules` and the client deep-relative-import rule.

## Shared sources of truth

- File → skills mapping: [`../skills/pr-self-review/reference/routing.md`](../skills/pr-self-review/reference/routing.md) (script twin `route.sh`). The planner fills its *Skills to apply* column from it, the implementer re-checks with `route.sh -`, and `pr-self-review` reviews with it, so plan, code and review use one map. Test paths are not routed yet; test-writer keeps its own per-package table.
- Rules: root and package `AGENTS.md`; learnings: package `INSIGHTS.md` (via `insight.sh`); server boundaries: `server/.dependency-cruiser.cjs` + known-violations baseline; severity: `../skills/pr-self-review/reference/severity.md`.
- Plans: `docs/plans/` (the plan for these four agents: [`docs/plans/feat-L02-skills.md`](../../docs/plans/feat-L02-skills.md)).

## Sources

Fetched 2026-09-30; Claude Code on this machine is 2.1.285. The Claude Code
docs below apply to every agent (frontmatter, hooks, no `AskUserQuestion`,
parent permission mode overriding the agent's, so hooks do the enforcing).

### A. planner and implementer

| Source | Used for |
|---|---|
| [Claude Code: Subagents](https://code.claude.com/docs/en/sub-agents) | Frontmatter fields (`tools`, `model`, `skills`, `hooks`, `maxTurns`); parent permission mode overrides the agent's; no `AskUserQuestion` in subagents; nesting depth, hence no `Agent` tool |
| [Claude Code: Skills](https://code.claude.com/docs/en/skills) | `skills:` preload injects full content, so only the two architecture skills are preloaded and the rest load per row |
| [Claude Code: Hooks guide](https://code.claude.com/docs/en/hooks-guide) | PreToolUse input on stdin, exit 2 blocks with stderr fed back to the agent |
| [Claude Code: Best practices](https://code.claude.com/docs/en/best-practices) | Explore → plan → implement → commit; self-contained plans with files, out-of-scope and verification; "give Claude a way to verify its work"; evidence over claims; writer/reviewer split with fresh context |
| [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Stopping conditions and checkpoints (implementer's stop-and-report list); evaluator needs clear criteria (acceptance criteria per plan) |
| [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Minimal, non-overlapping tool sets; plan as an external file referenced by path |
| [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Deterministic scripts over prose (hooks, `route.sh`, `insight.sh`) |

### B. test-writer

| Source | Used for |
|---|---|
| [Testing Library: Guiding principles](https://testing-library.com/docs/guiding-principles/) | Test behaviour the way the software is used |
| [Testing Library: Query priority](https://testing-library.com/docs/queries/about/#priority) | `getByRole` first, `getByTestId` last |
| [Testing Library: user-event](https://testing-library.com/docs/user-event/intro) | `userEvent` over `fireEvent`, `setup()` before render |
| [K. C. Dodds: Common mistakes with RTL](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library) (2020) | `findBy` over `waitFor(getBy)`, no needless `act` |
| [K. C. Dodds: Stop mocking fetch](https://kentcdodds.com/blog/stop-mocking-fetch) (2020) | Mock at the network boundary, not everywhere |
| [K. C. Dodds: Testing trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) (2021) | "Mostly integration": typological, not exhaustive |
| [Vitest: Mocking](https://vitest.dev/guide/mocking.html) | Reset mocks, timers and stubbed globals between tests |
| [Claude Code: Best practices](https://code.claude.com/docs/en/best-practices) | Separate test author from implementer; failing test first; evidence over claims |

### C. architecture-reviewer

| Source | Used for |
|---|---|
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | The rule engine behind `lint:arch`; error/warn/info severities |
| [ArchUnit](https://www.archunit.org/) | Architecture rules as automated tests (the concept `lint:arch` implements) |
| [Thoughtworks: Fitness function-driven development](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development) (2019) | Automated checks as architecture gatekeepers |
| [B. Böckeler: Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html) (2026) | Deterministic checks first, the LLM review only for what they cannot see |
| [Claude Code: Best practices](https://code.claude.com/docs/en/best-practices) | Fresh-context reviewer; a reviewer asked for gaps over-reports, so flag only what matters; line-referenced findings |

### D. plan-verifier

| Source | Used for |
|---|---|
| [Claude Code: Best practices](https://code.claude.com/docs/en/best-practices) | "Review the diff against PLAN.md … every requirement implemented … nothing outside the task's scope changed. Report gaps, not style preferences" |
| [Verification and validation](https://en.wikipedia.org/wiki/Verification_and_validation) ⚠ | Verification ("building the product right") only, not validation of the plan |
| [Requirements traceability matrix](https://www.perforce.com/resources/alm/requirements-traceability-matrix) ⚠ | Report shape: one row per requirement → code → evidence |

⚠ seen only as a search summary, not a fetched page; weaker than the rest.

### E. doc-writer

| Source | Used for |
|---|---|
| [Write the Docs: Docs as code](https://www.writethedocs.org/guide/docs-as-code/) | Docs in the repo, reviewed with the code |
| [Diátaxis](https://diataxis.fr/) | Keep kinds apart: spec (reference) vs design note (explanation) vs README (how-to) |
| [M. Nygard: Documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (2011) | Rejected alternatives and consequences in design notes |
| [C4 model](https://c4model.com/) | Diagram levels; diagrams as code |
| [GitHub: Creating diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) | Mermaid renders in Markdown on GitHub |

### F. brainstorm

Cited from known references on 2026-10-07, not re-fetched.

| Source | Used for |
|---|---|
| [M. Nygard: Documenting architecture decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (2011) | Options with consequences; the "when the runner-up wins" line records the rejected alternative |
| [Claude Code: Subagents](https://code.claude.com/docs/en/sub-agents) | Read-only tool set, no `AskUserQuestion` (questions come back in the report) |
| [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | A separate, fresh-context step that explores options before the plan is fixed |

### G. security-reviewer

Cited from known references on 2026-10-07, not re-fetched. The rules
themselves come from the vendored `security` skill (`.claude/skills/security/`).

| Source | Used for |
|---|---|
| [OWASP Top 10](https://owasp.org/Top10/) | Category ids in `rule` (`security › A05`) |
| [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/) | Prompt injection through PR content and untrusted model output |
| [FIRST: CVSS v4.0 specification](https://www.first.org/cvss/v4.0/specification-document) | Separating exploitability (who, what conditions) from impact when grading |
| [npm audit](https://docs.npmjs.com/cli/commands/npm-audit), [pnpm audit](https://pnpm.io/cli/audit) | Read-only dependency audits; `--fix` writes the lockfile, so the hook refuses it |

### Local decisions (not sourced)

- Models: opus for the planner (judgement over the whole task), the brainstorm (design trade-offs) and the security-reviewer (multi-hop source → sink tracing, where a miss is the costly error). Sonnet for the architecture-reviewer: since 2026-10-06 the tool facts come from `verify.sh` and the cruiser/ESLint rules, which leaves only placement judgement. Haiku for the plan-verifier (matching plan items to evidence that is already collected) and for the researcher's brief mode. Sonnet for the edit-heavy agents.
- The implementer reports plan contradictions instead of resolving them; test-writer reports source defects instead of fixing them.
- Where each kind of documentation goes is taken from the repo's existing `docs/` and `specs/` READMEs, not from an external source.
