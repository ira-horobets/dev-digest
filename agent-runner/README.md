# `@devdigest/agent-runner` — the CI runner (SPEC-05)

The program that runs inside a team's GitHub Actions workflow. It reads one
agent manifest, reviews the pull request with `@devdigest/reviewer-core`, posts
the result to GitHub and writes `devdigest-result.json`. It is bundled into one
file, `dist/index.js`, which is **committed**. The studio's "Export to CI"
wizard writes that file to `.devdigest/runner/index.js` in the target repo
(`server/src/platform/runner-bundle.ts` reads it). The studio side is
[`server/specs/export-to-ci.md`](../server/specs/export-to-ci.md).

## Commands (npm)

```sh
cd ../reviewer-core && npm ci   # first time: the runner imports its raw source
npm ci
npm run typecheck
npm run lint
npm test         # vitest; includes the stale-bundle test
npm run build    # node build.mjs -> dist/index.js (deterministic, commit the result)
```

`verify.sh`, `insight.sh` and `route.sh` do not know this package: run the
checks above explicitly. CI: `.github/workflows/agent-runner.yml`.

## What it does

`src/index.ts` calls `main()` in `src/main.ts`, which returns the exit code:

1. `env.ts` reads and validates `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH`, `GITHUB_API_URL` (default `https://api.github.com`), `DEVDIGEST_AGENT` (manifest path) and `DEVDIGEST_POST_AS` (`github_review`, `pr_comment`, `none`). An empty `OPENROUTER_API_KEY` stops the run with a message naming the secret (fork PRs get no secrets). Values are never logged.
2. `manifest.ts` parses `.devdigest/agents/<slug>.yaml` with `AgentManifest`, reads `.devdigest/skills/<slug>.md` (slugs must match `^[a-z0-9-]+$`) and the `content` of each `.devdigest/memory.jsonl` line (bad lines skipped).
3. `github.ts` (plain `fetch`, Bearer `GITHUB_TOKEN`) reads the PR number from the event payload, then the PR metadata and the diff.
4. `review.ts` parses the diff with `server/src/adapters/git/diff-parser.ts` (imported by relative path) and calls `reviewPullRequest` with an `OpenRouterProvider`. No repo index, specs, intent or callers.
5. `result.ts` builds the artifact (`CiResultArtifact` plus `verdict`, `blockers`, `model`) and the review payload. The event is `REQUEST_CHANGES` when `gateTriggered(findings, ci_fail_on)`, otherwise `COMMENT`. `APPROVE` is never sent (`github.ts` throws if asked).
6. `main.ts` writes `devdigest-result.json` in the working directory, then posts per mode: one review, one PR comment, or nothing.

Exit code: `0` when the gate is not triggered, `1` when it is, `2` on any error
before the review completed (no artifact is written). A failure to post never
changes the exit code.

### Posting fallback

In `github_review` mode a review rejected with 403 or 422 is retried once as a
`COMMENT` review when the first one was `REQUEST_CHANGES`; if that is rejected
too, the body is posted once as a PR comment. A stderr line points at
Settings → Actions → General → Workflow permissions. When the gate is off the
first review already is a `COMMENT`, so a rejection goes straight to the PR
comment.

## Bundle

`build.mjs` runs esbuild (`platform: node`, `target: node22`, ESM, no minify, no
timestamps) with aliases to `reviewer-core`, `@devdigest/shared` and this
package's own `zod`. The file starts with `// devdigest-ci/v1 · DevDigest
agent-runner · generated, do not edit`. `test/bundle.test.ts` rebuilds in memory
and fails when `dist/index.js` differs, so rebuild and commit whenever
`agent-runner/src`, `reviewer-core/src`, `server/src/vendor/shared` or the diff
parser change.

The workflow pins Node 22 (`actions/setup-node@v4`); the bundle is ESM run as
`node .devdigest/runner/index.js`, which relies on Node 22 module-syntax
detection and fails in a target repo that declares `"type": "commonjs"` at its
root.

## Layout

- `src/` — `env.ts` · `manifest.ts` · `github.ts` · `review.ts` · `result.ts` · `main.ts` · `index.ts`
- `test/` — `run.test.ts` (fake fetch, stub LLM) · `result.test.ts` · `github.test.ts` · `manifest.test.ts` · `bundle.test.ts`
- `build.mjs` · `dist/index.js` (committed)
