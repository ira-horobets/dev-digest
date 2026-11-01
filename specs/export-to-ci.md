# Spec: Export to CI
Spec ID: SPEC-05
Status: implemented
Supersedes: —

## Problem and user

A DevDigest agent only reviews pull requests when someone runs it by hand in the studio, on a PR that was imported into the local database. A team that wants the same reviewer on every PR, without a person clicking Run Review, has no way to get it: the agent's prompt, skills and gate setting live only in the local studio, and nothing runs in the team's CI.

What exists today:
- Tables `ci_installations` and `ci_runs` (`server/src/db/schema/ci.ts`) and the contracts `CiTarget`, `CiFile`, `AgentManifest`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRun`, `CiResultArtifact` (`server/src/vendor/shared/contracts/eval-ci.ts`). No route, service or UI uses them. There is no `server/src/modules/ci/` module, no CI tab on the agent page and no `/ci-runs` page.
- `GitHubClient.commitFiles`, `findOpenPr` and `openPullRequest` (`server/src/vendor/shared/adapters.ts`), which can create a branch such as `devdigest/ci` from a base and open a PR.
- `agents.ci_fail_on` (`never | critical | warning | any`), edited on the Config tab, and `gateTriggered` / `countBlockers` in `reviewer-core/src/output/to-review.ts`.
- `agent_runs.source` with values `local | ci`, defaulting to `local`.
- `client/messages/en/ci.json` and a `ci-runs` sidebar key in `client/src/components/app-shell/helpers.ts`, with wording that differs from the design.
- `reviewer-core` is documented as the engine shared with an "agent-runner", but no runner package exists.

Two facts shape the feature. First, the API runs on the user's machine and has no authentication (`server/src/app.ts` sets CORS only), so a GitHub-hosted runner cannot send results to it. Second, local reviews do not use memory today: `reviewer-core` accepts `ReviewInput.memory`, but the run executor never fills it (`memory_pulled: []` in `server/src/modules/reviews/run-executor.ts`) and embeddings are off unless `EMBEDDINGS_ENABLED=true`.

Users: the **agent author** who wants the agent to run in CI, and the **repo owner** who installs it, sets the gate and reads the results. They notice the gap today when they copy prompts into workflow files by hand and have no view of what the CI runs cost or found.

## Goals / Non-goals

Goals:
- An Export to CI wizard with four steps (Target, Preview, Configure, Install), opened from a new CI tab on the agent page.
- A generated, self-contained GitHub Actions setup: agent manifest, skills, `.devdigest/memory.jsonl`, a bundled agent-runner and an editable workflow file.
- Installation by opening a PR from a separate branch `devdigest/ci`, or by downloading a zip. The default branch is never written to.
- A CI tab that shows installations per repo, the workflow version, an out-of-date signal with "Update CI config", per-installation history and the "Fail CI on" setting.
- A CI Runs page with repository, PR, agent, verdict, findings, cost, duration and a link to the job.
- Results come back through a verified channel only (the GitHub API read by the studio), and are stored as runs with `source='ci'`.
- The user sees before installing what secrets are needed, whether they exist, and what a run is expected to cost.

Non-goals (each is something a user could reasonably expect):
- No CircleCI, Jenkins or Generic CLI target. They are not shown until a generator exists. There is no `devdigest review` CLI.
- No published `devdigest/review-action`. The mockup's `uses: devdigest/review-action@v1` is not emitted.
- No endpoint that accepts pushed CI results. No tunnel, no public URL, no webhook receiver.
- No creating or setting GitHub Actions secrets. DevDigest never reads or sends the OpenRouter key to GitHub.
- No GitHub App and no setting of branch protection or required status checks. The studio only explains how.
- No repo-intel, blast radius, project-context documents or intent derivation in CI reviews. A CI review sees the diff, the agent prompt, its linked skills and memory.
- No provider other than OpenRouter in CI.
- No uninstall or "remove from CI" action.
- No tracking of zip installs: nothing is recorded and no CI Runs appear for them.
- No MCP tool, no SSE event and no new env variable.
- No change to the multi-run service, the PR feed (PR list, PR run list, timeline) or the review run executor.
- No Evals or Stats tab. The mockup shows them, this repo's agent page has Config, Skills and Context only; this spec adds only the CI tab.

## User stories

- US-1 · As an agent author, I want to export an agent to GitHub Actions from a wizard, so that it reviews PRs without anyone running it by hand.
- US-2 · As a repo owner, I want to preview and edit the workflow before anything is written, so that I know exactly what lands in my repo.
- US-3 · As a repo owner, I want to choose triggers and how results are posted, and see which secrets are needed and the expected cost, so that the first CI run does not surprise me.
- US-4 · As a repo owner, I want the files delivered as a PR on a separate branch or as a zip, so that nothing is written to my default branch without review.
- US-5 · As a repo owner, I want to see where an agent is installed, its workflow version and history, and update it when it is out of date, so that CI matches the studio.
- US-6 · As a repo owner, I want to set when the agent fails the CI check, so that a critical finding can block a merge.
- US-7 · As a reviewer, I want a CI Runs page with verdict, findings, cost, duration and a link to the job, so that I can see what the CI reviews did.
- US-8 · As a repo owner, I want CI results accepted only through a verified channel, so that a forged result cannot enter my run history.

## Acceptance criteria (EARS)

Wizard entry and Target (US-1)

- AC-1 (US-1) · WHEN the user opens an agent page, the system shall show a "CI" tab after the existing tabs, with the heading "CI deployment".
- AC-2 (US-1) · WHEN the user clicks "Add to CI" or the dashed "Add repository" row, the system shall open the "Export to CI" modal on step 1 with the stepper Target, Preview, Configure, Install.
- AC-3 (US-1) · The Target step shall list only targets whose generator exists. In this spec that is "GitHub Actions" (`gha`), marked "recommended" and pre-selected.
- AC-4 (US-1) · The Target step shall include a repository selector that lists the imported repos as `owner/name`, and shall keep Continue disabled until one is selected.
- AC-5 (US-1) · IF the agent's `provider` is not `openrouter`, THEN the system shall keep Continue disabled and show a message that names the provider and says CI supports OpenRouter only.

Preview (US-2)

- AC-6 (US-2) · WHEN the Preview step opens, the system shall list under "Files to create" the manifest `.devdigest/agents/<slug>.yaml`, one `.devdigest/skills/<skill-slug>.md` per skill linked to the agent, `.devdigest/memory.jsonl`, `.devdigest/runner/index.js` and `.github/workflows/devdigest-review.yml`.
- AC-7 (US-2) · The manifest shall contain exactly the `AgentManifest` fields `name`, `provider`, `model`, `system_prompt`, `skills`, `strategy` and `ci_fail_on` taken from the agent.
- AC-8 (US-2) · The file `.devdigest/memory.jsonl` shall contain one JSON line per `memory` row with scope `repo` for the selected repo or scope `global`, newest first, limited to 200 items and 100 KB, with the fields `id`, `scope`, `kind` and `content` and without embeddings. It shall be present and empty when no row qualifies.
- AC-9 (US-2) · The workflow file shall be shown in a viewer marked "editable" and every other file shall be read-only.
- AC-10 (US-2) · The workflow shall trigger on `pull_request` with the types chosen in Configure, run on `ubuntu-latest`, check out the repo, run the bundled runner `.devdigest/runner/index.js` with `node`, pass `OPENROUTER_API_KEY` and `GITHUB_TOKEN` from secrets, and upload an artifact named `devdigest-result`.
- AC-11 (US-2) · The workflow shall declare the least `permissions` that the chosen "Post results as" mode needs, and a `concurrency` group per PR number with `cancel-in-progress` set to true.
- AC-12 (US-2) · The workflow and the runner shall carry a header that states the template version (`devdigest-ci/v1`), and the workflow shall not reference `devdigest/review-action`.
- AC-13 (US-2) · WHEN the user changes a Configure option after editing the workflow, the system shall warn that regenerating discards the edits and shall regenerate only after the user confirms.
- AC-14 (US-2) · IF the edited workflow is not valid YAML, THEN the system shall show the parse error and keep Install disabled.
- AC-15 (US-2) · IF the edited workflow contains text that looks like an API key, THEN the system shall show a warning next to the viewer and still allow Install.
- AC-16 (US-2) · IF `.github/workflows/devdigest-review.yml` already exists in the target repo and does not carry the DevDigest header, THEN the system shall mark it "will overwrite" in Preview and require an explicit confirmation before Install.

Configure (US-3)

- AC-17 (US-3) · The Configure step shall show the triggers `pull_request:opened` and `pull_request:synchronize` selected and `pull_request:reopened` unselected by default, and shall keep Continue disabled while none is selected.
- AC-18 (US-3) · The Configure step shall list the expected secrets `OPENROUTER_API_KEY` and `GITHUB_TOKEN`, each with a status badge, and the line "Add these to your repo's Actions secrets before the workflow runs."
- AC-19 (US-3) · The system shall show `GITHUB_TOKEN` as "ready" in every case, because Actions provides it.
- AC-20 (US-3) · WHEN the Configure step opens, the system shall read the names of the target repo's Actions secrets and organization secrets available to it, and show `OPENROUTER_API_KEY` as "ready" when listed.
- AC-21 (US-3) · The system shall show `OPENROUTER_API_KEY` as "not set" only when the secret list was read successfully and does not contain it.
- AC-22 (US-3) · IF the secret list cannot be read (403, 404, network, rate limit, or environment secrets only), THEN the system shall show `OPENROUTER_API_KEY` as "unknown" with a short reason.
- AC-23 (US-3) · The Configure step shall offer "Post results as" with "GitHub review" (recommended, default), "PR comment" and "None (exit code only)".
- AC-24 (US-3) · The Configure step shall show an info box that says to set "Fail CI on" on the CI tab and add a required status check in the repo's branch protection, and that no GitHub App is needed.
- AC-25 (US-3) · The Configure step shall show the agent's average cost per run (`avg_cost_usd`) with a note that CI runs are billed to the repo's OpenRouter key, or "no run history yet" when the agent has no completed runs.

Install (US-4)

- AC-26 (US-4) · The Install step shall offer "Open a PR with these files" (recommended, default) and "Copy files as a zip", and a link to the GitHub Action setup docs that opens GitHub's "Using secrets in GitHub Actions" documentation page.
- AC-27 (US-4) · The Install step shall state the repo and the number of generated files in the PR option.
- AC-28 (US-4) · WHEN the user chooses the PR option and clicks Install, the system shall commit all files in one commit to the branch `devdigest/ci`, created from the target repo's default branch, and open a PR titled "Add DevDigest CI review" into that default branch.
- AC-29 (US-4) · The system shall never write a commit to the target repo's default branch or to any branch other than `devdigest/ci`.
- AC-30 (US-4) · IF an open PR from `devdigest/ci` already exists in the repo, THEN the system shall add the commit to that branch and reuse the PR instead of opening a second one.
- AC-31 (US-4) · WHEN the PR is opened, the system shall show its URL, record one installation for the agent, repo and target, and record an install event.
- AC-32 (US-4) · IF no `GITHUB_TOKEN` is available to the studio, THEN the system shall disable the PR option with a reason and keep the zip option available.
- AC-33 (US-4) · IF GitHub rejects the write (missing scope, repo not found, branch conflict, validation error), THEN the system shall show GitHub's reason, name the missing token permission when it can be derived, and record no installation.
- AC-34 (US-4) · WHEN the user chooses the zip option and clicks Install, the system shall download a zip of the files exactly as shown in Preview, make no GitHub write and record no installation.

CI tab (US-5, US-6)

- AC-35 (US-5) · The CI tab shall show one row per installation with the repo, "GitHub Actions", the outcome of the last export ("succeeded" or "failed"), how long ago it happened, the PR state (open, merged, closed) as a link, and the workflow version.
- AC-36 (US-5) · The CI tab shall show a badge "Active in N repos" where N is the number of installations whose PR was merged, and "Not active in any repo" when N is 0.
- AC-37 (US-5) · WHEN the CI tab opens, the system shall read the PR state of each installation from GitHub, and IF GitHub cannot be reached, THEN it shall show the last known state marked "could not refresh".
- AC-38 (US-5) · The system shall mark an installation "out of date" when a regeneration of its non-editable files, or its template version, differs from what was last exported.
- AC-39 (US-5) · WHILE at least one installation is out of date, the system shall enable "Update CI config"; otherwise it shall disable it.
- AC-40 (US-5) · WHEN the user clicks "Update CI config", the system shall list the out-of-date repos and warn that edits to the workflow in `devdigest/ci` will be overwritten, and shall proceed only after confirmation.
- AC-41 (US-5) · WHEN the user confirms an update, the system shall, per repo, commit the regenerated files to `devdigest/ci`, reuse the open PR or open a new PR titled "Update DevDigest CI config" when none is open, and record an update event.
- AC-42 (US-5) · WHEN the user expands an installation, the system shall list its history, one entry per install or update event, with time, action, template version, outcome and PR link.
- AC-43 (US-6) · The CI tab shall show the "Fail CI on" setting with the options never, critical, warning and any, bound to the same `ci_fail_on` field as the Config tab.
- AC-44 (US-6) · WHEN the user changes "Fail CI on" on the CI tab, the system shall save it to the agent and show the installations as out of date.
- AC-45 (US-5) · WHILE the agent has no installation, the CI tab shall show an empty state "Not deployed to CI yet" with an "Add to CI" action.

Runner (US-6)

- AC-46 (US-6) · WHEN the workflow runs on a PR, the runner shall read the diff and PR metadata through the GitHub API with `GITHUB_TOKEN`, run the agent through `reviewPullRequest` with the manifest, skills and the `content` of the memory lines, and ground findings as `reviewer-core` does.
- AC-47 (US-3) · WHERE "Post results as" is "GitHub review", the runner shall post one GitHub review with the verdict event; WHERE it is "PR comment", one PR comment; WHERE it is "None", nothing.
- AC-48 (US-6) · The runner shall exit non-zero if and only if `gateTriggered(findings, ci_fail_on)` is true, and shall exit zero otherwise.
- AC-49 (US-6) · WHERE "Post results as" is "GitHub review" and the gate is not triggered, the runner shall post the review with the `COMMENT` event instead of `REQUEST_CHANGES`.
- AC-50 (US-7) · WHEN a review completes, the runner shall write `devdigest-result.json` with the fields of `CiResultArtifact` plus `verdict`, `blockers` and `model` **(new)**, and upload it as the artifact `devdigest-result`.
- AC-51 (US-7) · IF `OPENROUTER_API_KEY` is empty (fork PR or secret not set), THEN the runner shall exit non-zero with a message that names the secret and writes no artifact.

Ingest and storage (US-7, US-8)

- AC-52 (US-8) · The system shall accept CI results only by reading workflow runs and the artifact `devdigest-result` through the GitHub API for a repo and workflow path of a recorded installation. It shall expose no route that accepts a pushed result.
- AC-53 (US-7) · WHEN the user clicks Refresh on CI Runs, or auto-refresh fires, the system shall read up to the 50 most recent completed runs of `devdigest-review.yml` per installation and ingest those not yet stored.
- AC-54 (US-8) · IF an artifact is missing, larger than 1 MB, or fails `CiResultArtifact` validation, THEN the system shall store the run as `failed` with null counts and an error text, and shall store no partial values.
- AC-55 (US-7) · The system shall store each GitHub run attempt at most once, keyed by installation, GitHub run id and run attempt.
- AC-56 (US-7) · The system shall store each ingested run as one `ci_runs` row (repo through the installation, PR number, verdict, duration, job URL, GitHub run id and attempt) and one linked `agent_runs` row with `source='ci'`, `kind='review'`, the agent, provider, model, cost, duration, findings count and blockers.
- AC-57 (US-7) · The system shall store `agent_runs.pr_id` as null for every CI run, so that CI runs never appear in a PR's run list, cost rollup or timeline.
- AC-58 (US-7) · The system shall set the `agent_runs` status to `done` when a valid artifact exists, even if the job failed on the gate, and to `failed` otherwise.
- AC-59 (US-7) · The system shall take the job URL from the GitHub API response and not from the artifact.
- AC-60 (US-7) · The system shall never write an `agent_runs` row with status `running` for a CI run.
- AC-61 (US-7) · WHILE a workflow run is in progress, the CI Runs page shall show it with status "Running" without storing it.
- AC-62 (US-7) · The CI run status shall be `no_findings` when the job succeeded with zero findings, `succeeded` when it succeeded with findings, and `failed` when the job did not succeed.

CI Runs page (US-7)

- AC-63 (US-7) · The sidebar shall show a "GLOBAL" group **(new)** in `client/src/vendor/ui/nav.ts` that contains the item "CI Runs" linking to `/ci-runs`, placed after "Agent Performance" once that item exists. Until then the group holds "CI Runs" only.
- AC-64 (US-7) · The CI Runs page shall list for each run the repository, the pull request, the agent, the verdict, the findings count, the cost, the duration, the timestamp, the status and a link to the GitHub job.
- AC-65 (US-7) · The CI Runs page shall offer filters for time range (default "Last 7 days"), agent, repo and status, and a "Refresh" button with an "auto-refresh on" toggle.
- AC-66 (US-7) · WHILE the page is visible and auto-refresh is on, the system shall refresh every 60 seconds, and shall stop while the tab is hidden.
- AC-67 (US-7) · WHERE the PR of a run belongs to an imported repo and is imported, the run row shall link to that PR's page in the studio.
- AC-68 (US-7) · IF GitHub answers with a rate limit, THEN the system shall keep the stored rows, show when to retry, and make no further GitHub calls until then.
- AC-69 (US-7) · WHILE no CI run exists, the CI Runs page shall show "No CI runs yet" with the text that runs appear once an agent is exported to CI.

Cross-cutting

- AC-70 (US-1) · The system shall use the following labels: "Add to CI", "Update CI config", "CI deployment", "Active in {n} repos", "Export to CI", "Open a PR with these files", "Copy files as a zip", "Post results as", and shall remove the unused `ciTab` and `publishDialog` keys and the "Requires a GitHub App" text from `client/messages/en/ci.json`.
- AC-71 (US-1) · The system shall read the GitHub token only through `SecretsProvider` and shall never return it in a response, a log line, a generated file or the run trace.

## Edge cases

| # | Case | What the user sees | Refines |
|---|---|---|---|
| EC-1 | The token lacks `workflow` scope (classic) or Workflows write (fine-grained) | Install fails with GitHub's reason and the missing permission named; no installation row. Needed permissions: Contents RW, Pull requests RW, Workflows RW, Actions read; Secrets read is optional. | AC-33 |
| EC-2 | Double click on Install, or Install while a PR is already open | One PR, one more commit at most, one installation row (unique per agent, repo, target). | AC-30, AC-31 |
| EC-3 | The human edited `devdigest/ci` after the PR opened | An update adds a commit on top and may overwrite their edits; the confirmation says so. | AC-40 |
| EC-4 | The PR was merged or closed and `devdigest/ci` was deleted | Update creates the branch again from the default branch and opens a new PR. | AC-41 |
| EC-5 | Agent has zero skills, or zero memory rows | No skill files; `.devdigest/memory.jsonl` is listed and empty. | AC-6, AC-8 |
| EC-6 | Huge memory (more than 200 items or 100 KB) | The newest items that fit are written; Preview shows "N of M items". | AC-8 |
| EC-7 | Local reviews do not use memory, CI reviews do (decision D-3) | The Preview line for the memory file says "used by CI reviews only". | AC-8, AC-46 |
| EC-8 | Secrets are org-level or environment-level | Org secrets are checked; environment secrets are not, so the badge can be "unknown". | AC-20, AC-22 |
| EC-9 | Token cannot list secrets (403) | "unknown", never "not set". | AC-22 |
| EC-10 | Fork PR | The job fails with the message about the missing secret; the run shows as failed. Repo owners who require the check should expect fork PRs to fail it. | AC-51 |
| EC-11 | Every push triggers a paid run | Older runs for the same PR are cancelled by the concurrency group. | AC-11 |
| EC-12 | Same run ingested twice (Refresh, auto-refresh, workflow re-run attempt) | One row per run attempt; a re-run attempt is a new row. | AC-55 |
| EC-13 | Job crashed before uploading the artifact, or artifact is forged or oversize | A failed row with an error text and no counts. | AC-54 |
| EC-14 | The runner cost or counts are wrong or forged | They are shown as reported; they are bounded (non-negative, finite, counts capped) by validation. | AC-54 |
| EC-15 | PR of a CI run is not imported in the studio | The row shows the PR number as plain text and still links to the job. | AC-67 |
| EC-16 | GitHub rate limit or network error during Refresh | Banner with the retry time; stored rows stay. | AC-68 |
| EC-17 | Workflow run still in progress | A "Running" row that disappears into a stored row after completion. | AC-61 |
| EC-18 | The user changed "Fail CI on" or the prompt after export | The installation is marked "out of date"; "Update CI config" becomes enabled. | AC-38, AC-44 |
| EC-19 | Agent edited so its provider is no longer `openrouter` | Existing installations keep running with the exported manifest; the next export is blocked. | AC-5 |
| EC-20 | Agent deleted | Its installations and `ci_runs` follow the existing cascade and set-null rules (`ci_installations.agent_id` cascades, `agent_runs.agent_id` sets null). | AC-56 |
| EC-21 | Workflow disabled or removed in the repo by hand | Runs stop appearing; the row stays. No detection in v1. | AC-37 |
| EC-22 | Existing `.devdigest/` files in the repo | They are replaced by the commit; Preview shows only the workflow overwrite warning. | AC-16 |
| EC-23 | Zip chosen | Nothing is recorded; CI Runs never shows runs from that repo. | AC-34 |
| EC-24 | Agent runs recorded as `source='ci'` change the agent card stats | Accepted by design: the cost is real (decision D-2). | AC-57 |
| EC-25 | Modal closed mid-way | Nothing is written; reopening starts at step 1. | AC-2 |
| EC-26 | Keyboard use | The stepper, triggers, radios and the modal's close action work from the keyboard; focus returns to "Add to CI" on close. | AC-2 |

Verified in the repo for AC-57: the PR run list, the in-flight list and the per-PR cost rollup (`server/src/modules/reviews/repository/run.repo.ts`) filter by `pr_id` and `kind='review'` and have no `source` filter, so a CI row with a non-null `pr_id` would leak into them. With `pr_id` null it cannot. The only query that picks CI rows up is the agent card average (`server/src/modules/agents/repository.ts`, status `done`, kind `review`, no `source` filter). `AgentPerf` has a contract but no route in `server/src/modules`. The boot reaper marks every `running` row failed (`run.repo.ts`), which is why AC-60 forbids storing `running` CI rows.

## Non-functional requirements

- Latency: opening the Preview step shall return the generated files within 2 seconds for an agent with up to 10 skills, with no model call. The secrets check shall not delay Preview.
- Cost: the studio makes no model call for export, preview, install, ingest or display. All model cost of a CI run is billed to the repo's OpenRouter key and is shown on CI Runs (AC-64) and as an estimate in Configure (AC-25).
- Rate limits: one Refresh shall read at most 50 workflow runs plus one artifact per not-yet-stored run per installation. Auto-refresh is 60 seconds and pauses while the tab is hidden.
- Size: an ingested artifact is limited to 1 MB. `.devdigest/memory.jsonl` is limited to 100 KB.
- Security: the token never leaves the server; generated files, logs and responses contain no secret; CI results come only through the GitHub API; every query is scoped to the workspace through the agent; the workflow requests the least `permissions`.
- Accessibility: all wizard controls reachable and operable by keyboard; the modal traps focus and restores it; status and badge colours come from design tokens, never hard-coded.
- Consistency: both copies of `@devdigest/shared` change together for every changed contract, and any new UI piece (stepper, step cards, file viewer, status badge) is added to `/showcase`.

## Inputs and provenance

| Input | Source | Provenance | Owner |
|---|---|---|---|
| Agent name, provider, model, system prompt, strategy, `ci_fail_on`, version | `agents` table, `Agent` contract | [reused: `AgentManifest` in `contracts/eval-ci.ts`] | agents module |
| Linked skills (slug, body) | `skills` module | [reused: skill links and `PluginSkill` shape] | skills module |
| Memory rows | `memory` table, `MemoryItem` | [reused: `memory` table] mapped to JSON lines [deterministic] | ci module (new) |
| Imported repos for the selector | `repos` table | [reused: `repos` module] | repos module |
| Target repo default branch, existing files, PR state | GitHub API through `GitHubClient` | [reused: `commitFiles`, `findOpenPr`, `openPullRequest`] plus read methods [new] | ci module (new) |
| Secret names (repo and org) | GitHub API | [new] read method on `GitHubClient` | ci module (new) |
| GitHub token | `SecretsProvider` key `GITHUB_TOKEN` | [reused: `LocalSecretsProvider`] | platform |
| Generated files (manifest, skills, memory, runner, workflow) | `POST /agents/:id/ci/preview` **(new)** | [deterministic: templates, no model] | ci module (new) |
| Export request | `POST /agents/:id/export-ci` | [reused: `CiExportInput`, `CiExport`] | ci module (new) |
| Installations, events, out-of-date flag | `GET /agents/:id/ci/installations` **(new)**; tables `ci_installations` (new columns: `status`, `branch`, `pr_url`, `pr_number`, `workflow_version`, `config_hash`, `post_as`, `triggers`; unique on agent, repo, target) and `ci_installation_events` **(new)** | [new] | ci module (new) |
| Update of one installation | `POST /agents/:id/ci/installations/:installationId/update` **(new)** | [new] | ci module (new) |
| Secret status | `GET /agents/:id/ci/secrets?repo=` **(new)** | [new] | ci module (new) |
| Fail CI on | `PATCH` on the agent | [reused: `ci_fail_on` in agents routes] | agents module |
| Average cost per run | `AgentCardStats.avg_cost_usd` | [reused: agents repository] | agents module |
| Workflow runs, job URL, run id, attempt, in-progress state | GitHub API | [new] | ci module (new) |
| Result artifact | `devdigest-result.json` in artifact `devdigest-result` | [reused: `CiResultArtifact`], with `verdict`, `blockers`, `model` [new] | agent-runner (new) |
| CI run rows | `GET /ci/runs` **(new)** with `CiRun` extended by `repo`, `verdict`, `blockers` [new]; `POST /ci/runs/refresh` **(new)**; tables `ci_runs` (new columns: `github_run_id`, `run_attempt`, `verdict`, `duration_ms`, `agent_run_id`, `error`) and `agent_runs` with `source='ci'` | [reused: `ci_runs`, `agent_runs.source`] | ci module (new) |
| Findings count, severity counts, cost, duration | artifact | [deterministic: computed by the runner; no studio recomputation] | agent-runner (new) |
| Verdict, blockers | artifact | [deterministic: `toReviewPayload`, `countBlockers` from `reviewer-core`] | agent-runner (new) |
| Review content in CI | runner call to the model | [llm: one structured review call per `reviewer-core` strategy] | agent-runner (new) |
| The bundled runner `.devdigest/runner/index.js` | new package `agent-runner/` (`@devdigest/agent-runner`), built into one file, consuming `reviewer-core` by path alias; the server embeds the built file | [new] | agent-runner (new) |
| Mockup layout and labels | five design images | [new] | design |

Design details reconciled with the mockups:
- The workflow in the mockup passes `openai-key: secrets.OPENAI_API_KEY` and uses `devdigest/review-action@v1`. The Configure step lists `OPENROUTER_API_KEY`. The spec follows Configure and the OpenRouter-only engine, and emits a `node` step for the bundled runner (AC-10, AC-12).
- The mockup's Preview shows five files and the Install text says "the 5 generated files". The count is dynamic here (manifest, N skills, memory, runner, workflow), so the text shows the real number (AC-27).
- The mockup's Target step shows four cards and no repository field. The spec shows only GitHub Actions and puts the repository selector in that step, because the secrets check needs the repo (AC-3, AC-4).
- The row chip "succeeded" is read as the outcome of the last export, not of the last CI run, and a separate PR-state tag was added (AC-35).
- The "Update CI config" button sits in the header and acts on all out-of-date repos (AC-39, AC-40).
- The mockup's `not set` and `ready` badges gain a third state, `unknown` (AC-22).
- The mockup's stepper shows completed steps with a check mark; Back is available on steps 2 to 4.
- The new sidebar entry sits in a new GLOBAL group (D-8). It follows "Agent Performance" as drawn once that item exists; until then GLOBAL holds "CI Runs" only.

## Untrusted inputs

| Input | Handling |
|---|---|
| `devdigest-result.json` artifact | Data only. Capped at 1 MB, validated with `CiResultArtifact`, numbers bounded, never executed or rendered as markup. Job URL and repo come from the GitHub API, not from it. |
| GitHub API responses (runs, secrets list, files, PR state) | Parsed and validated as data. Errors are mapped to messages without echoing raw HTML. |
| PR title, body and diff read by the runner | Wrapped as untrusted by `reviewer-core` (`wrapUntrusted`, `INJECTION_GUARD`); no keyword scanning. |
| Existing files in the target repo (workflow content) | Read only to detect the DevDigest header; never interpreted or followed. |
| The edited workflow text | Parsed as YAML and scanned for key-like strings; written verbatim only after the user confirms. |
| Repo names typed or chosen by the user | Matched against the imported repos; passed to GitHub only as `owner/name` after format validation. |
| Skill bodies and agent prompt | Written into repo files as data; the Preview shows them before anything is written. |
| Memory content | Written as JSON-encoded strings; fed to the runner as the curated `memory` input and shown in Preview first. |
| Fork PR content | The runner gets no secrets and fails with a message; its content is never trusted. |

## Open questions

None open. The seven questions of the first draft were answered by accepting the suggested answers. They are recorded here as decisions.

- D-1 · The "GitHub Action setup docs" link opens GitHub's "Using secrets in GitHub Actions" page until a DevDigest page exists (AC-26).
- D-2 · CI runs count in the agent card stats (run count and average cost in `agents/repository.ts`), because the cost is real. Separating them would be a change in the agents module and a follow-up spec. CI runs do not reach the PR feed (AC-57).
- D-3 · Memory is included in CI reviews as written in AC-8 and AC-46, although local reviews do not use memory. Preview says so (EC-7).
- D-4 · The memory caps are 200 items and 100 KB (AC-8).
- D-5 · "Update CI config" is one header button acting on all out-of-date repos after a confirmation (AC-39, AC-40).
- D-6 · The runner is a new package `agent-runner/` (`@devdigest/agent-runner`), built into one file and consuming `reviewer-core` by path alias. The server embeds the built file as `.devdigest/runner/index.js`. How it is built and delivered is a plan decision. The root layout table and the docs get an entry when it is implemented. The name `agent-runner/` is reserved for this feature.
- D-7 · Out-of-date detection compares regenerated content, so skill or prompt edits are detected without relying on the agent version (AC-38).
- D-8 · Approved exception to the do-not-touch rule for `client/src/vendor/ui/`: this feature edits `client/src/vendor/ui/nav.ts` to add the GLOBAL group with "CI Runs" (AC-63). Today `nav.ts` has only the WORKSPACE and SKILLS LAB groups, with no GLOBAL group and no "Agent Performance" item. The parallel multi-agent-review worktree also adds one `nav.ts` entry, so a small merge conflict is expected. No other file under `client/src/vendor/ui/` changes.
