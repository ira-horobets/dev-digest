import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const INTENT = { intent: 'Adds a stripe key.', in_scope: ['config'], out_of_scope: [] };

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'One finding.',
  score: 50,
  findings: [
    { id: 'a', severity: 'CRITICAL', category: 'security', title: 'Key', file: 'src/config.ts', start_line: 11, end_line: 11, rationale: 'r', confidence: 0.9, kind: 'finding' },
  ],
};

/** Holds every review call until `release()`, so a test can act while runs are in flight. */
class GatedLLM extends MockLLMProvider {
  private gate!: () => void;
  private opened = new Promise<void>((r) => (this.gate = r));
  inFlight = 0;
  release() {
    this.gate();
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.inFlight++;
    await this.opened;
    return super.completeStructured(req);
  }
}

d('multi-agent runs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const makeApp = (llm: Record<string, MockLLMProvider>) =>
    buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        secrets: new MockSecretsProvider(),
        github: new MockGitHubClient(),
        llm: { openrouter: new MockLLMProvider('openai', { structuredBySchema: { IntentDerivation: INTENT } }), ...llm },
      },
    });

  const seedPr = async (number: number) => {
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `multi-${number}`, fullName: `acme/multi-${number}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number, title: 'Multi', author: 'dev', branch: 'b', base: 'main', headSha: 'abc', additions: 1, deletions: 0, filesCount: 1, status: 'needs_review' })
      .returning();
    await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,' });
    return pr!;
  };

  type App = Awaited<ReturnType<typeof makeApp>>;
  const mkAgent = async (app: App, name: string, provider: 'openai' | 'anthropic') =>
    (await app.inject({ method: 'POST', url: '/agents', payload: { name, provider, model: 'gpt-4.1', system_prompt: 'p' } })).json() as { id: string };

  it('AC-1/4/5/6/7/32: rows first, one intent and diff per run, a failed agent isolated, read model stable', async () => {
    const app = await makeApp({
      openai: new MockLLMProvider('openai', { structured: REVIEW }),
      anthropic: new MockLLMProvider('anthropic', { structured: { not: 'a review' } }),
    });
    const pr = await seedPr(101);
    const good = await mkAgent(app, 'Good A', 'openai');
    const good2 = await mkAgent(app, 'Good B', 'openai');
    const bad = await mkAgent(app, 'Bad C', 'anthropic');

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: [good.id, good2.id, bad.id] } });
    expect(res.statusCode).toBe(200);
    const started = res.json();
    expect(started.runs).toHaveLength(3);
    const children = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.multiRunId, started.multi_run_id));
    expect(children).toHaveLength(3);
    const [parent] = await pg.handle.db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.id, started.multi_run_id));
    expect(parent!.prId).toBe(pr.id);

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });

    // AC-4: shared pre-work once. One intent row; every run's trace has the diff load and the intent call.
    const intents = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(intents).toHaveLength(1);
    const traces = await pg.handle.db.select().from(t.runTraces).where(inArray(t.runTraces.runId, started.runs.map((r: { run_id: string }) => r.run_id)));
    for (const row of traces) {
      const trace = row.trace as { log: { msg: string }[]; tool_calls: { tool: string }[] };
      expect(trace.log.filter((l) => l.msg === 'Loading PR diff').length).toBeLessThanOrEqual(1);
    }
    expect(traces.filter((r) => (r.trace as { tool_calls: { tool: string }[] }).tool_calls.some((c) => c.tool === 'derive_intent'))).toHaveLength(2);

    // AC-5/6/7
    const byId = (await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.multi_run_id}` })).json();
    expect(byId.status).toBe('done');
    expect(byId.agent_count).toBe(3);
    expect(byId.columns.map((c: { status: string }) => c.status).sort()).toEqual(['done', 'done', 'failed']);
    const failed = byId.columns.find((c: { status: string }) => c.status === 'failed');
    expect(failed.error).toBeTruthy();
    expect(byId.total_cost_usd).toBeGreaterThan(0);
    expect(byId.conflicts).toHaveLength(1);
    expect(byId.conflicts[0].conflict).toBe(false); // both flaggers agree; the failed agent is no_result, not silent
    expect(byId.conflicts[0].takes.map((x: { verdict: string }) => x.verdict).sort()).toEqual(['CRITICAL', 'CRITICAL', 'no_result']);

    // A second multi-agent run is newer: GET latest returns it, by-id still returns the first.
    const second = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: [good.id, good2.id] } })).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 5 });
    const latest = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` })).json();
    expect(latest.id).toBe(second.multi_run_id);
    expect((await app.inject({ method: 'GET', url: `/multi-agent-runs/${started.multi_run_id}` })).json().id).toBe(started.multi_run_id);

    // AC-32: reads do not write findings.
    const before = await pg.handle.db.select().from(t.findings);
    await app.inject({ method: 'GET', url: `/multi-agent-runs/${second.multi_run_id}` });
    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent` });
    expect(await pg.handle.db.select().from(t.findings)).toEqual(before);

    // Other workspace: 404.
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-multi' }).returning();
    const [foreign] = await pg.handle.db.insert(t.multiAgentRuns).values({ workspaceId: other!.id, prId: pr.id }).returning();
    expect((await app.inject({ method: 'GET', url: `/multi-agent-runs/${foreign!.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('AC-2: 404 for an unknown agent or PR and 400 for a bad count, with no rows created', async () => {
    const app = await makeApp({ openai: new MockLLMProvider('openai', { structured: REVIEW }) });
    const pr = await seedPr(102);
    const a = await mkAgent(app, 'Solo A', 'openai');
    const b = await mkAgent(app, 'Solo B', 'openai');
    const before = {
      runs: (await pg.handle.db.select().from(t.agentRuns)).length,
      multi: (await pg.handle.db.select().from(t.multiAgentRuns)).length,
    };
    const post = (prId: string, ids: string[]) =>
      app.inject({ method: 'POST', url: `/pulls/${prId}/multi-agent-run`, payload: { agent_ids: ids } });
    expect((await post(pr.id, [a.id, '00000000-0000-4000-8000-000000000999'])).statusCode).toBe(404);
    expect((await post('00000000-0000-4000-8000-000000000998', [a.id, b.id])).statusCode).toBe(404);
    expect((await post(pr.id, [a.id])).statusCode).toBe(400);
    expect({
      runs: (await pg.handle.db.select().from(t.agentRuns)).length,
      multi: (await pg.handle.db.select().from(t.multiAgentRuns)).length,
    }).toEqual(before);
    await app.close();
  });

  it('AC-8/9, TC-5: estimates average the last 10 done review runs and ignore brief and failed runs', async () => {
    const app = await makeApp({ openai: new MockLLMProvider('openai', { structured: REVIEW }) });
    const pr = await seedPr(103);
    const withHistory = await mkAgent(app, 'History', 'openai');
    const fresh = await mkAgent(app, 'No history', 'openai');
    const base = Date.parse('2026-01-01T00:00:00Z');
    const row = (i: number, over: Partial<typeof t.agentRuns.$inferInsert> = {}) => ({
      workspaceId,
      agentId: withHistory.id,
      prId: pr.id,
      kind: 'review' as const,
      status: 'done',
      durationMs: 1000 * i,
      costUsd: 0.1 * i,
      ranAt: new Date(base + i * 60_000),
      ...over,
    });
    await pg.handle.db.insert(t.agentRuns).values([
      ...Array.from({ length: 11 }, (_, i) => row(i)),
      row(50, { kind: 'brief', durationMs: 999_000 }),
      row(51, { status: 'failed', durationMs: 888_000 }),
    ]);
    const est = (await app.inject({ method: 'GET', url: '/multi-agent/estimates' })).json();
    expect(est.concurrency).toBe(3);
    const h = est.agents.find((a: { agent_id: string }) => a.agent_id === withHistory.id);
    expect(h.samples).toBe(10);
    expect(h.duration_ms).toBe(5500); // runs 1..10: the oldest (0) falls out of the window
    expect(h.cost_usd).toBeCloseTo(0.55);
    const f = est.agents.find((a: { agent_id: string }) => a.agent_id === fresh.id);
    expect(f).toMatchObject({ duration_ms: null, cost_usd: null, samples: 0 });
    await app.close();
  });

  it('TC-4: a queued run cancelled before it starts never starts; a cancelled in-flight run stays cancelled', async () => {
    const gated = new GatedLLM('openai', { structured: REVIEW });
    const app = await makeApp({ openai: gated });
    const pr = await seedPr(104);
    const agents = [];
    for (let i = 1; i <= 4; i++) agents.push(await mkAgent(app, `Gate ${i}`, 'openai'));

    const started = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/multi-agent-run`, payload: { agent_ids: agents.map((a) => a.id) } })).json();
    const runOf = (i: number) => started.runs[i].run_id as string;
    // Wait for the cap (3) to be in flight; the fourth is queued.
    for (let i = 0; i < 400 && gated.inFlight < 3; i++) await new Promise((r) => setTimeout(r, 25));
    expect(gated.inFlight).toBe(3);

    await app.inject({ method: 'POST', url: `/runs/${runOf(3)}/cancel` }); // queued
    await app.inject({ method: 'POST', url: `/runs/${runOf(0)}/cancel` }); // in flight
    gated.release();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 3 });
    await new Promise((r) => setTimeout(r, 200));

    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.multiRunId, started.multi_run_id));
    const status = Object.fromEntries(runs.map((r) => [r.id, r.status]));
    expect(status[runOf(0)]).toBe('cancelled');
    expect(status[runOf(1)]).toBe('done');
    expect(status[runOf(2)]).toBe('done');
    expect(status[runOf(3)]).toBe('cancelled');
    expect(gated.inFlight).toBe(3); // the queued run never called the model
    const reviews = await pg.handle.db.select().from(t.reviews).where(inArray(t.reviews.runId, [runOf(0), runOf(3)]));
    expect(reviews).toHaveLength(0);
    await app.close();
  }, 120_000);
});
