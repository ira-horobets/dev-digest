/**
 * SPEC-04 Eval Pipeline — integration test (Testcontainers Postgres).
 *
 * Proves, against a real database: the eval migrations apply cleanly (startPg
 * runs them), a triaged finding becomes a case with one call (idempotent on
 * the second), a hand-authored must_not_flag case is accepted, a suite run
 * executes in the background and is scored in code, and EVERY read route
 * (cases, runs, dashboard, agent detail, compare) answers over its documented
 * surface without a single model call — the mock LLM's call counter is the
 * witness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  EvalAgentDetail,
  EvalCase,
  EvalCaseFromFindingResult,
  EvalCompare,
  EvalDashboard,
  EvalRunRecord,
  EvalRunResult,
} from '@devdigest/shared';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** The model "finds" the seeded Stripe key at src/config.ts:12 on every call. */
const REVIEW_FIXTURE = {
  verdict: 'request_changes',
  summary: 'A live key is committed.',
  score: 35,
  findings: [
    {
      id: 'f-stripe',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'Line 12 commits a secret.',
      suggestion: 'Move it to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

const BENIGN_DIFF = `diff --git a/src/utils/format.ts b/src/utils/format.ts
--- a/src/utils/format.ts
+++ b/src/utils/format.ts
@@ -3,5 +3,5 @@ import { Money } from "../types";

-export function fmt(m: Money): string {
-  return \`\${m.currency} \${(m.cents / 100).toFixed(2)}\`;
+export function formatMoney(money: Money): string {
+  return \`\${money.currency} \${(money.cents / 100).toFixed(2)}\`;
 }`;

async function waitForRun(app: FastifyInstance, runId: string): Promise<EvalRunRecord> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/eval/runs/${runId}` });
    expect(res.statusCode).toBe(200);
    const run = res.json() as EvalRunRecord;
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('eval run did not settle');
}

d('eval pipeline routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let llm: MockLLMProvider;
  let agentId: string;
  let findingId: string;

  beforeAll(async () => {
    pg = await startPg(); // runs every migration incl. 0018/0019 on a fresh database
    await seed(pg.handle.db);
    llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openrouter: llm, openai: llm, anthropic: llm } },
    });

    // The seeded Stripe-key finding and the agent that owns its review.
    const [finding] = await pg.handle.db
      .select({ id: t.findings.id, reviewId: t.findings.reviewId })
      .from(t.findings)
      .where(eq(t.findings.file, 'src/config.ts'));
    findingId = finding!.id;
    const [review] = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.id, finding!.reviewId));
    agentId = review!.agentId!;
    expect(agentId).toBeTruthy();
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('refuses an untriaged finding, then freezes it with one call (idempotent on the second)', async () => {
    const untriaged = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(untriaged.statusCode).toBe(422);
    expect(untriaged.json().error.code).toBe('finding_not_triaged');

    const accept = await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` });
    expect(accept.statusCode).toBe(200);

    const first = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(first.statusCode).toBe(201);
    const created = first.json() as EvalCaseFromFindingResult;
    expect(created.created).toBe(true);
    expect(created.case.owner_id).toBe(agentId);
    expect(created.case.expectation).toMatchObject({ type: 'must_find', file: 'src/config.ts', start_line: 12 });
    expect(created.case.input_diff).toContain('+++ b/src/config.ts');
    expect(created.case.source_finding_id).toBe(findingId);

    const second = await app.inject({ method: 'POST', url: `/findings/${findingId}/eval-case` });
    expect(second.statusCode).toBe(200);
    expect((second.json() as EvalCaseFromFindingResult).created).toBe(false);
    expect((second.json() as EvalCaseFromFindingResult).case.id).toBe(created.case.id);
  });

  it('accepts a hand-authored must_not_flag case and refuses an ungrounded one', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval/cases`,
      payload: {
        name: 'clean-rename-no-flags',
        notes: null,
        input_diff: BENIGN_DIFF,
        input_files: ['src/utils/format.ts'],
        input_meta: { pr_number: null, title: 'Rename formatter', body: null },
        expectation: { type: 'must_not_flag', file: 'src/utils/format.ts', start_line: 3, end_line: 7 },
      },
    });
    expect(ok.statusCode).toBe(201);

    const ungrounded = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval/cases`,
      payload: {
        name: 'outside-every-hunk',
        input_diff: BENIGN_DIFF,
        input_files: ['src/utils/format.ts'],
        input_meta: { pr_number: null, title: 'x', body: null },
        expectation: { type: 'must_find', file: 'src/utils/format.ts', start_line: 90, end_line: 95 },
      },
    });
    expect(ungrounded.statusCode).toBe(422);
    expect(ungrounded.json().error.code).toBe('expectation_not_grounded');

    const list = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval/cases` });
    expect(list.statusCode).toBe(200);
    expect((list.json() as EvalCase[]).map((c) => c.expectation.type).sort()).toEqual(['must_find', 'must_not_flag']);
  });

  it('runs the suite in the background and scores it in code — one model call per case, none on reads', async () => {
    const before = llm.calls.length;
    const start = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` });
    expect(start.statusCode).toBe(202);
    const started = start.json() as EvalRunResult;
    expect(started.scope).toBe('suite');
    expect(started.estimate.cases_total).toBe(2);

    const run = await waitForRun(app, started.run_id);
    expect(run.status).toBe('completed');
    expect(run.agent_version).toBeGreaterThanOrEqual(1);
    const m = run.metrics!;
    // must_find hit at 12; the same finding on the benign case is DROPPED by
    // grounding (file not in that diff) → must_not_flag passes, precision 1,
    // citation accuracy 1 kept of 2 emitted.
    expect(m.recall).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.citation_accuracy).toBeCloseTo(0.5);
    expect(m.traces_passed).toBe(2);
    expect(m.traces_total).toBe(2);
    expect(m.cases_errored).toBe(0);
    expect(llm.calls.filter((c) => c.method === 'completeStructured').length - before).toBe(2);

    // A second completed run so compare has a pair.
    const again = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` });
    expect(again.statusCode).toBe(202);
    const second = await waitForRun(app, (again.json() as EvalRunResult).run_id);
    expect(second.status).toBe('completed');

    const callsBeforeReads = llm.calls.length;
    const runs = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval/runs` });
    expect(runs.statusCode).toBe(200);
    expect((runs.json() as EvalRunRecord[]).length).toBe(2);

    const dash = await app.inject({ method: 'GET', url: '/eval/dashboard' });
    expect(dash.statusCode).toBe(200);
    const row = (dash.json() as EvalDashboard).agents.find((a) => a.agent_id === agentId)!;
    expect(row.cases_total).toBe(2);
    expect(row.runs_total).toBe(2);
    expect(row.latest!.metrics!.recall).toBe(1);

    const detail = await app.inject({ method: 'GET', url: `/eval/agents/${agentId}?days=all` });
    expect(detail.statusCode).toBe(200);
    const det = detail.json() as EvalAgentDetail;
    expect(det.trend).toHaveLength(2);
    expect(det.current!.precision).toBe(1);
    expect(Object.keys(det.case_outcomes)).toHaveLength(2);

    const cmp = await app.inject({ method: 'GET', url: `/eval/compare?a=${run.id}&b=${second.id}` });
    expect(cmp.statusCode).toBe(200);
    const c = cmp.json() as EvalCompare;
    expect(c.common_case_ids).toHaveLength(2);
    expect(c.deltas.recall).toBe(0);
    expect(c.prompt_a).toBeTruthy(); // seeded v1 snapshot (or live prompt) is available
    expect(c.prompt_diff.every((l) => l.kind === 'context')).toBe(true);

    const bad = await app.inject({ method: 'GET', url: `/eval/compare?a=${run.id}&b=${run.id}` });
    expect(bad.statusCode).toBe(422);

    // Zero model calls across every read above.
    expect(llm.calls.length).toBe(callsBeforeReads);
  });

  it('refuses a run for an agent with no cases and a case run with a foreign id', async () => {
    const [other] = await pg.handle.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(eq(t.agents.name, 'Performance Reviewer'));
    const none = await app.inject({ method: 'POST', url: `/agents/${other!.id}/eval/runs` });
    expect(none.statusCode).toBe(422);
    expect(none.json().error.code).toBe('no_cases');

    const foreign = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/eval/runs`,
      payload: { case_ids: ['00000000-0000-0000-0000-000000000000'] },
    });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().error.code).toBe('unknown_case');
  });
});
