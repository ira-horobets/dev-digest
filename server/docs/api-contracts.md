# API Contracts

Base URL: `http://localhost:3001`

All routes use `fastify-type-provider-zod`. Every input and output is validated by Zod schemas defined in `src/vendor/shared/` (the `@devdigest/shared` package).

## Routes

### Repos

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos` | List all repos |
| `POST` | `/repos` | Add a repo (by GitHub URL or local path) |
| `GET` | `/repos/:id` | Get repo details |

### Pulls

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos/:repoId/pulls` | List PRs for a repo |
| `POST` | `/repos/:repoId/pulls/import` | Import PRs from GitHub |
| `GET` | `/pulls/:id` | Get PR details (with diff) |
| `POST` | `/pulls/:id/review` | Start a review run → returns `{ runId }` |

Rate limit: `POST /pulls/:id/review` — 120/min globally.

### Reviews & Runs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pulls/:id/reviews` | List reviews for a PR |
| `GET` | `/reviews/:id` | Get review with findings |
| `GET` | `/runs/:id/events` | SSE stream of `RunEvent` objects |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents |
| `POST` | `/agents` | Create agent |
| `PUT` | `/agents/:id` | Update agent |
| `DELETE` | `/agents/:id` | Delete agent |

### Eval Pipeline

Cases are frozen inputs (one file's diff fragment + one expectation); a run replays an agent version over its case set and is scored **in code** (file equality + line-range intersection — no model judge). Runs execute in the background; clients poll `GET /eval/runs/:id` until `status !== "running"`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/findings/:id/eval-case` | Turn a triaged finding into a case (accepted → `must_find`, dismissed → `must_not_flag`). `201` created / `200` already existed. Body: `{ case, created, agent_name }` |
| `GET` | `/agents/:id/eval/cases` | The agent's case set |
| `POST` | `/agents/:id/eval/cases` | Hand-authored case (`EvalCaseInput`) |
| `GET` / `PATCH` / `DELETE` | `/eval/cases/:id` | One case; edits are re-validated (size cap + expectation must fall inside a hunk) |
| `POST` | `/agents/:id/eval/runs` | Start a run → `202 EvalRunResult`. Body `{ case_ids? }`: omitted = suite run (dashboard/trend/compare use suite runs only), given = ad-hoc `case` run |
| `GET` | `/agents/:id/eval/runs` | Run history (any scope) |
| `GET` | `/eval/runs/:id` | One run (`metrics` null while running) |
| `POST` | `/eval/runs/all` | `{ confirm: true }` → suite run for every enabled agent with ≥1 case; per-agent `started / refused_reason` |
| `GET` | `/eval/dashboard` | `EvalDashboard`: one row per agent (latest suite run + recall trend) and the recent runs table |
| `GET` | `/eval/agents/:id?days=30` | `EvalAgentDetail`: runs in the window, trend, current metrics, delta vs previous, callout, latest outcome per case. `days=all` disables the window |
| `GET` | `/eval/compare?a=&b=` | `EvalCompare`: older → newer deltas over the common case ids, flipped cases, and the system-prompt line diff from `agent_versions` |

Metrics (`EvalRun`, every ratio `null` when its denominator is empty): `recall` = must_find cases passed / must_find cases; `precision` = 1 − findings matching a must_not_flag case / all kept findings; `citation_accuracy` = findings kept by the grounding gate / findings emitted.

Run-start routes are rate-limited (5/min) and refuse with `409 run_in_flight`, `422 no_cases`, `422 provider_not_configured`.

### Repo Intel

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repos/:id/index` | Trigger symbol/import indexing |
| `GET` | `/repos/:id/map` | Get repo map (for review context) |

### Settings & Workspace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Get current settings (providers, models) |
| `PUT` | `/settings` | Update settings |
| `GET` | `/workspace` | Workspace status |

## SSE Protocol — `GET /runs/:id/events`

The client subscribes with `EventSource`. The server emits `RunEvent` objects as newline-delimited JSON in the `data` field of each SSE message.

```typescript
// RunEvent union — defined in @devdigest/shared
type RunEvent =
  | { type: "started";   runId: string }
  | { type: "log";       runId: string; message: string }
  | { type: "progress";  runId: string; step: string; percent: number }
  | { type: "completed"; runId: string; reviewId: string }
  | { type: "failed";    runId: string; error: string }
```

Connection closes automatically on `completed` or `failed`.

## Zod Schema Locations

All schemas are in `server/src/vendor/shared/`. Key files:

| File | Contains |
|------|---------|
| `review.ts` | `Review`, `Finding`, `Severity`, `Verdict` |
| `agent.ts` | `Agent`, `CreateAgentBody` |
| `repo.ts` | `Repo`, `Pull` |
| `settings.ts` | `Settings`, `LLMProvider` enum |
| `run.ts` | `Run`, `RunEvent` |
| `contracts/knowledge.ts` | `EvalExpectation`, `EvalCase`, `EvalCaseOutcome`, `EvalRun` |
| `contracts/eval-ci.ts` | `EvalCaseInput`, `EvalRunRecord`, `EvalDashboard`, `EvalAgentDetail`, `EvalCompare` |

## Error Format

All errors return:
```json
{ "statusCode": 422, "error": "Unprocessable Entity", "message": "..." }
```

Zod validation failures return `422` with the full Zod error tree in `message`.
