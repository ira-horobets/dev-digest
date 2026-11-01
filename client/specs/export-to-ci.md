# Export to CI (SPEC-05) — client

Spec: specs/export-to-ci.md (SPEC-05)

The CI tab on the agent page, the four-step "Export to CI" wizard, the update
dialog and the `/ci-runs` page. The API half (routes, tables, generated files,
ingest rules) is [`server/specs/export-to-ci.md`](../../server/specs/export-to-ci.md).

Status: **implemented 2026-11-01**.

## Surfaces

| Surface | Where | Notes |
|---|---|---|
| CI tab | `/agents/[id]?tab=ci`, last tab of `AgentEditor` (`AgentEditor/_components/CiTab`) | heading "CI deployment" |
| Export wizard | `agents/[id]/_components/ExportCiWizard` (+ `TargetStep`, `PreviewStep`, `ConfigureStep`, `InstallStep`) | `Modal` "Export to CI" with `Stepper` Target · Preview · Configure · Install |
| Installation row | `agents/[id]/_components/CiInstallationRow` | expandable history |
| Update dialog | `agents/[id]/_components/CiUpdateDialog` | |
| CI Runs | `/ci-runs` (`app/ci-runs/page.tsx` → `CiRunsView`, `CiRunRow`) | sidebar group GLOBAL → "CI Runs" (`vendor/ui/nav.ts`) |
| Shared pieces | `components/stepper`, `option-card`, `file-viewer`, `ci-status-badge`; `lib/download.ts` | all on `/showcase` (group "CI") |

## Hooks (`src/lib/hooks/ci.ts`, imported directly, not through the barrel)

| Hook | Endpoint |
|---|---|
| `useCiPreview(agentId, input)` | `POST /agents/:id/ci/preview`, re-fetched on repo, post-as or trigger change |
| `useCiSecrets(agentId, repo)` | `GET /agents/:id/ci/secrets?repo=`, separate from Preview so it never delays it |
| `useExportCi()` | `POST /agents/:id/export-ci`; `meta: { silent: true }` so the global toast is skipped and the wizard shows the reason inline |
| `useCiInstallations(agentId)` | `GET /agents/:id/ci/installations` |
| `useUpdateCiInstallation()` | `POST /agents/:id/ci/installations/:installationId/update`, one call per installation (silent) |
| `useSetCiFailOn(agentId)` | `PUT /agents/:id` via `useUpdateAgent`, then invalidates `["ci-installations", agentId]` |
| `useCiRuns(filters)` | `GET /ci/runs` (stored rows) |
| `useRefreshCiRuns()` | `POST /ci/runs/refresh`; invalidates `["ci-runs"]` |
| `useAutoRefreshCiRuns(onTick, { enabled, retryAt })` | none; 60 s interval, only while `document.visibilityState === "visible"` and after `retryAt` |

`providers.tsx` `MutationCache.onError` skips mutations with `meta.silent`.
Shared contract types are imported as types only; the enums are mirrored in
local `constants.ts`.

## CI tab (`CiTab`)

- Header: heading "CI deployment", badge "Active in N repos" (N = merged PRs) or "Not active in any repo", buttons "Update CI config" and "Add to CI". "Update CI config" is enabled only while an installation is `out_of_date`.
- "Fail CI on" select (never, critical, warning, any) bound to the agent's `ci_fail_on` through `useSetCiFailOn`; saving makes installations show "out of date".
- One `CiInstallationRow` per installation: repo, "GitHub Actions", last export outcome, age, PR state as a link, workflow version, "out of date", and "could not refresh" when `pr_state_stale`. Expanding lists the history events (time, action, template version, outcome, PR link).
- A dashed "Add repository" row opens the wizard. Empty state: "Not deployed to CI yet" with "Add to CI".
- "Update CI config" opens `CiUpdateDialog`: lists the out-of-date repos, warns that edits to the workflow in `devdigest/ci` will be overwritten, and on confirm updates each installation in turn, showing the per-repo outcome.
- Focus returns to "Add to CI" when the wizard closes.

## Wizard (`ExportCiWizard`)

All state lives in the wizard and resets when it closes; nothing is written
before Install. Back is available on steps 2–4.

1. **Target.** One card, "GitHub Actions" (recommended, pre-selected). A native select lists the imported repos as `owner/name` (`useRepos`). Continue is disabled until a repo is chosen. When the agent's provider is not `openrouter` a message names the provider and says CI supports OpenRouter only, and Continue stays disabled.
2. **Preview.** "Files to create": the manifest, one file per skill, `memory.jsonl`, the runner, the workflow, each in a `FileViewer`. The workflow is "editable" (a labelled textarea); the others are read-only. Invalid YAML shows the parse error and disables Install. Key-like text shows a warning and Install stays possible. A workflow that exists in the repo without the DevDigest header shows "will overwrite" and a confirm checkbox. A memory line shows "used by CI reviews only" and "N of M items"; `memory.dropped > 0` adds "N memory items left out"; `repo_public` true with memory included shows a warning that global memory will be published.
3. **Configure.** Triggers: `opened` and `synchronize` on, `reopened` off, Continue disabled while none is on. "Post results as": GitHub review (recommended, default), PR comment, None (exit code only); under GitHub review a hint says the repo's Actions settings may reject reviews and the runner then posts a comment. Expected secrets with `CiStatusBadge` (`ready`, `not set`, `unknown` with reason) and the line "Add these to your repo's Actions secrets before the workflow runs." An info box explains "Fail CI on" and the required status check, and that no GitHub App is needed. The agent's average cost per run, or "no run history yet". Changing an option after the workflow was edited asks for confirmation before regenerating, because it discards the edits.
4. **Install.** "Open a PR with these files" (default; states the repo and file count; disabled with a reason when `studio_token` is false) or "Copy files as a zip". A docs link opens GitHub's secrets documentation. PR: `useExportCi`, button disabled while pending, then the PR URL; on failure GitHub's reason and the missing permission are shown inline. The request sends `workflow` when edited, `confirm_overwrite` when confirmed, and `confirm_secret_warning: true` when the key warning was shown. Zip: `fflate.zipSync` over the exact previewed files (edited workflow included) and `downloadBlob`; no API call and nothing recorded.

## CI Runs (`CiRunsView`)

- Filters: time range (default "Last 7 days"), agent (`useAgents`), repo (`useRepos`), status; kept in URL params with `router.replace`. The page wraps the view in `Suspense` (reads `useSearchParams`).
- "Refresh" calls `useRefreshCiRuns` and merges the returned in-progress rows on top with status "Running"; an "auto-refresh on" toggle runs `useAutoRefreshCiRuns`.
- Columns: repository, pull request, agent, verdict, findings, cost, duration, timestamp, status, GitHub job link. The PR cell links to `/repos/{repo_id}/pulls/{number}` when `pr_link` is set, else shows `#n`. Findings and cost cells carry a "Reported by the CI job, not verified" tooltip and the header has a visible note.
- Rate limit: when `retry_at` is set, a banner shows the retry time, stored rows stay and Refresh is disabled until then.
- Empty: "No CI runs yet", with the text that runs appear once an agent is exported to CI.

## Tests

`CiTab.test.tsx`, `ExportCiWizard.test.tsx`, `ExportCiWizard/helpers.test.ts`, `CiRunsView.test.tsx`, `lib/hooks/ci.test.ts`, `AgentEditor.test.tsx` (CI tab last), `components/option-card` keyboard test, the `/showcase` smoke test.

## Plan versus code

- The wizard uses a native `<select>` and `<textarea>`. Focus return uses a wrapper span because `Button` forwards no ref and `vendor/ui` is off limits.
- The `Modal` primitive has no focus trap (it lives in `vendor/ui`); Escape closes it. This is short of the focus-trap wording in NFR-6.
- The showcase group is in `components/showcase/Showcase.tsx` (the page only mounts the gallery). `agents.json` `editor.tabs.ci` already existed, so no edit was needed.
- Not exercised: the manual sidebar check and a browser run against real GitHub. The first `/ci-runs` auto-refresh fires only after the first 60 s.
