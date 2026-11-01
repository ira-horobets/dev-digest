import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zipSync } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider, MockEmbedder } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) console.warn('[ci] Docker not available, skipping integration tests.');

const REPO = 'acme/payments-api';
const WORKFLOW = '.github/workflows/devdigest-review.yml';

const artifact = (over: object = {}) =>
  zipSync({
    'devdigest-result.json': new TextEncoder().encode(
      JSON.stringify({
        findings_count: 2,
        critical: 1,
        warning: 1,
        suggestion: 0,
        cost_usd: 0.05,
        duration_ms: 4000,
        agent: 'Security Reviewer',
        version: 'devdigest-ci/v1',
        pr_number: 482,
        verdict: 'request_changes',
        blockers: 1,
        model: 'deepseek/deepseek-v4-flash',
        ...over,
      }),
    ),
  });

const wfRun = (id: number, over: object = {}) => ({
  id,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  pr_numbers: [482],
  created_at: new Date().toISOString(),
  run_started_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...over,
});

d('ci (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let otherAgentId: string;
  let prId: string;
  let repoId: string;
  let github: MockGitHubClient;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const agents = await db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    agentId = agents.find((a) => a.name === 'Security Reviewer')!.id;
    otherAgentId = agents.find((a) => a.name === 'Performance Reviewer')!.id;
    await db.update(t.agents).set({ provider: 'openrouter' }).where(eq(t.agents.id, agentId));
    await db.update(t.agents).set({ provider: 'openai' }).where(eq(t.agents.id, otherAgentId));
    const [repo] = await db.select().from(t.repos).where(eq(t.repos.fullName, REPO));
    repoId = repo!.id;
    const [pr] = await db.select().from(t.pullRequests).where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
    prId = pr!.id;
    // memory: this repo, another repo, global
    const [other] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'other', fullName: 'acme/other' })
      .returning();
    await db.insert(t.memory).values([
      { workspaceId, repoId, scope: 'repo', kind: 'fact', content: 'repo memory' },
      { workspaceId, repoId: other!.id, scope: 'repo', kind: 'fact', content: 'other repo memory' },
      { workspaceId, repoId: null, scope: 'global', kind: 'fact', content: 'global memory' },
    ]);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(opts: ConstructorParameters<typeof MockGitHubClient>[0] = {}) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    github = new MockGitHubClient(opts);
    return buildApp({
      config: { ...config, repoIntelEnabled: false },
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        github,
        secrets: new MockSecretsProvider({ GITHUB_TOKEN: 'ghp_x' }),
      },
    });
  }

  const exportBody = { repo: REPO, post_as: 'github_review', triggers: ['opened', 'synchronize'] };

  it('preview: memory = this repo + global only, newest first, no embedding; workflow editable only', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/ci/preview`, payload: exportBody });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const memory = body.files.find((f: { path: string }) => f.path === '.devdigest/memory.jsonl');
    const lines = memory.contents.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(lines.map((l: { content: string }) => l.content).sort()).toEqual(['global memory', 'repo memory']);
    expect(Object.keys(lines[0])).toEqual(['id', 'scope', 'kind', 'content']);
    expect(body.memory).toEqual({ included: 2, total: 2, dropped: 0 });
    expect(body.repo_public).toBe(false);
    expect(body.files.filter((f: { editable: boolean }) => f.editable).map((f: { path: string }) => f.path)).toEqual([WORKFLOW]);
    expect(body.workflow_state).toBe('absent');
    await app.close();
  });

  it('refuses a provider other than openrouter and an unimported repo', async () => {
    const app = await makeApp();
    const wrongProvider = await app.inject({ method: 'POST', url: `/agents/${otherAgentId}/ci/preview`, payload: exportBody });
    expect(wrongProvider.statusCode).toBe(422);
    const noRepo = await app.inject({ method: 'POST', url: `/agents/${agentId}/ci/preview`, payload: { ...exportBody, repo: 'x/y' } });
    expect(noRepo.statusCode).toBe(404);
    await app.close();
  });

  it('export failure records nothing (AC-33)', async () => {
    const err = Object.assign(new Error('Resource not accessible'), {
      status: 403,
      tokenKind: 'fine_grained',
      acceptedPermissions: [['workflows=write']],
    });
    const app = await makeApp({ failures: { commitFiles: err } });
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: exportBody });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.details.missing_permission).toBe('Workflows: write');
    expect(await pg.handle.db.select().from(t.ciInstallations)).toHaveLength(0);
    await app.close();
  });

  let installationId: string;

  it('export: one installation + one install event; a second export keeps one installation (AC-31, EC-2)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: exportBody });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr_url).toBe('https://github.com/mock/mock/pull/1');
    installationId = res.json().installation.id;
    await app.inject({ method: 'POST', url: `/agents/${agentId}/export-ci`, payload: exportBody });
    const installs = await pg.handle.db.select().from(t.ciInstallations);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toMatchObject({ repo: REPO, targetType: 'gha', branch: 'devdigest/ci', prNumber: 1, workflowVersion: 'devdigest-ci/v1' });
    const events = await pg.handle.db.select().from(t.ciInstallationEvents);
    expect(events.map((e) => e.action)).toEqual(['install', 'install']);
    const list = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` });
    expect(list.json().installations[0]).toMatchObject({ out_of_date: false, pr_state: 'open' });
    expect(list.json().installations[0].events).toHaveLength(2);
    await app.close();
  });

  it('installations are scoped to the agent (another agent sees none)', async () => {
    const app = await makeApp();
    const list = await app.inject({ method: 'GET', url: `/agents/${otherAgentId}/ci/installations` });
    expect(list.json()).toEqual({ installations: [], active_count: 0 });
    const update = await app.inject({ method: 'POST', url: `/agents/${otherAgentId}/ci/installations/${installationId}/update` });
    expect(update.statusCode).toBe(404);
    await app.close();
  });

  it('changing ci_fail_on makes the installation out of date; update clears it (AC-44, AC-41)', async () => {
    const app = await makeApp({ pullStates: { 1: 'merged' } });
    const put = await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { ci_fail_on: 'warning' } });
    expect(put.statusCode).toBe(200);
    let list = (await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` })).json();
    expect(list.installations[0].out_of_date).toBe(true);
    expect(list.installations[0].pr_state).toBe('merged');
    expect(list.active_count).toBe(1);
    const upd = await app.inject({ method: 'POST', url: `/agents/${agentId}/ci/installations/${installationId}/update` });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().error).toBeNull();
    list = (await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` })).json();
    expect(list.installations[0].out_of_date).toBe(false);
    expect(list.installations[0].events.map((e: { action: string }) => e.action)[0]).toBe('update');
    await app.close();
  });

  it('refresh ingests valid, missing and invalid artifacts as ci_runs + agent_runs (AC-53..60)', async () => {
    const prRunsBefore = (await (await makeApp()).inject({ method: 'GET', url: `/pulls/${prId}/runs` })).json();
    const app = await makeApp({
      workflowRuns: [wfRun(101), wfRun(102), wfRun(103), wfRun(104, { status: 'in_progress', conclusion: null })],
      artifacts: { 101: artifact(), 103: artifact({ cost_usd: 1e9 }) },
    });
    const res = await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ingested: 3, retry_at: null, errors: [] });
    expect(res.json().running).toHaveLength(1);
    expect(res.json().running[0].status).toBe('running');

    const ciRuns = await pg.handle.db.select().from(t.ciRuns);
    expect(ciRuns).toHaveLength(3);
    const byRun = Object.fromEntries(ciRuns.map((r) => [r.githubRunId, r]));
    expect(byRun[101]).toMatchObject({ status: 'failed', findingsCount: 2, verdict: 'request_changes', blockers: 1, githubUrl: `https://github.com/${REPO}/actions/runs/101`, source: 'ci' });
    expect(byRun[102]).toMatchObject({ status: 'failed', findingsCount: null });
    expect(byRun[102]!.error).toBeTruthy();
    expect(byRun[103]!.findingsCount).toBeNull();

    const agentRuns = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'));
    expect(agentRuns).toHaveLength(3);
    expect(agentRuns.every((r) => r.prId === null && r.kind === 'review' && r.status !== 'running')).toBe(true);
    expect(agentRuns.filter((r) => r.status === 'done')).toHaveLength(1);
    expect(byRun[101]!.agentRunId).toBe(agentRuns.find((r) => r.status === 'done')!.id);

    // CI runs never reach the PR's run list.
    const prRunsAfter = (await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` })).json();
    expect(prRunsAfter).toEqual(prRunsBefore);
    await app.close();
  });

  it('refresh twice stores nothing new; a re-run attempt is a new row (AC-55)', async () => {
    const app = await makeApp({
      workflowRuns: [wfRun(101), wfRun(101, { run_attempt: 2 })],
      artifacts: { 101: artifact() },
    });
    const first = await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    expect(first.json().ingested).toBe(1);
    const second = await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    expect(second.json().ingested).toBe(0);
    expect(await pg.handle.db.select().from(t.ciRuns)).toHaveLength(4);
    expect(await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'))).toHaveLength(4);
    await app.close();
  });

  it('GET /ci/runs: filters, pr_link for an imported PR, agent name', async () => {
    const app = await makeApp();
    const all = (await app.inject({ method: 'GET', url: '/ci/runs' })).json().runs;
    expect(all).toHaveLength(4);
    expect(all[0]).toMatchObject({ repo: REPO, agent: 'Security Reviewer', source: 'ci', pr_number: 482 });
    expect(all[0].pr_link).toEqual({ repo_id: repoId, number: 482 });
    const failed = (await app.inject({ method: 'GET', url: '/ci/runs?status=failed' })).json().runs;
    expect(failed).toHaveLength(4);
    expect((await app.inject({ method: 'GET', url: '/ci/runs?status=succeeded' })).json().runs).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/ci/runs?agent_id=${otherAgentId}` })).json().runs).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/ci/runs?repo=acme/other' })).json().runs).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/ci/runs?range=24h' })).json().runs).toHaveLength(4);
    // PR not imported -> no link
    await pg.handle.db.update(t.ciRuns).set({ prNumber: 99999 });
    const unlinked = (await app.inject({ method: 'GET', url: '/ci/runs' })).json().runs;
    expect(unlinked.every((r: { pr_link: unknown }) => r.pr_link === null)).toBe(true);
    await app.close();
  });

  it('deleting the agent cascades the installation and hides its runs (EC-20)', async () => {
    const app = await makeApp();
    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agentId));
    expect(await pg.handle.db.select().from(t.ciInstallations)).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/ci/runs' })).json().runs).toHaveLength(0);
    await app.close();
  });
});
