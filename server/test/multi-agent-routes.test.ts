/** multi-agent routes: edge behaviour without a database (fake repository). */
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { FakeMultiAgentRepo, PR_ID, agentId } from './helpers/multi-agent.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('multi-agent routes (no DB)', () => {
  it('400 for 1 and 9 ids and duplicates; 422 for a non-array body; nothing created', async () => {
    const repo = new FakeMultiAgentRepo();
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider(), multiAgentRepo: repo } });
    const post = (body: unknown) =>
      app.inject({ method: 'POST', url: `/pulls/${PR_ID}/multi-agent-run`, payload: body as object });
    expect((await post({ agent_ids: [agentId(1)] })).statusCode).toBe(400);
    expect((await post({ agent_ids: Array.from({ length: 9 }, (_, i) => agentId(i)) })).statusCode).toBe(400);
    const dup = await post({ agent_ids: [agentId(1), agentId(1)] });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error.code).toBe('invalid_agent_selection');
    expect((await post({ agent_ids: 'x' })).statusCode).toBe(422);
    expect(repo.created).toHaveLength(0);
    await app.close();
  });

  it('registers the three reads and validates :id at the edge', async () => {
    const app = await buildApp({ config, overrides: { auth: new MockAuthProvider(), multiAgentRepo: new FakeMultiAgentRepo() } });
    expect((await app.inject({ method: 'GET', url: '/multi-agent-runs/nope' })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/multi-agent` })).statusCode).toBe(404);
    const est = await app.inject({ method: 'GET', url: '/multi-agent/estimates' });
    expect(est.statusCode).toBe(200);
    expect(est.json().concurrency).toBe(3);
    await app.close();
  });
});
