/**
 * ci: route tests without a database. Only the edge is covered here (schema
 * validation, the route table, the committed runner bundle); DB-backed behaviour
 * lives in ci.it.test.ts and the service tests.
 */
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { loadRunnerBundle } from '../src/platform/runner-bundle.js';
import { FakeCiRepo } from './helpers/ci.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '11111111-1111-4111-8111-111111111111';

const makeApp = () =>
  buildApp({ config, overrides: { auth: new MockAuthProvider(), ciRepo: new FakeCiRepo() } });

describe('ci routes (no DB)', () => {
  it('rejects bad bodies and params with the 422 envelope', async () => {
    const app = await makeApp();
    const bad = async (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object });
    expect((await bad(`/agents/${ID}/export-ci`, { repo: '' })).statusCode).toBe(422);
    expect((await bad(`/agents/${ID}/export-ci`, { repo: 'a/b', triggers: [] })).statusCode).toBe(422);
    expect((await bad(`/agents/${ID}/export-ci`, { repo: 'a/b', triggers: ['push'] })).statusCode).toBe(422);
    expect((await bad(`/agents/${ID}/export-ci`, { repo: 'a/b', action: 'files' })).statusCode).toBe(422);
    expect((await bad(`/agents/${ID}/export-ci`, { repo: 'a/b', workflow: 'x'.repeat(65537) })).statusCode).toBe(422);
    expect((await bad(`/agents/${ID}/ci/preview`, { repo: 'a/b', post_as: 'email' })).statusCode).toBe(422);
    expect((await bad('/agents/not-a-uuid/ci/preview', { repo: 'a/b' })).statusCode).toBe(422);
    const q = await app.inject({ method: 'GET', url: '/ci/runs?range=1y' });
    expect(q.statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/agents/${ID}/ci/secrets` })).statusCode).toBe(422);
    await app.close();
  });

  it('a valid preview of an unknown agent is a clean 404', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${ID}/ci/preview`,
      payload: { repo: 'acme/api' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });

  it('the route table has no route that accepts a pushed result (AC-52)', async () => {
    const app = await makeApp();
    const table = app.printRoutes({ commonPrefix: false });
    const ciLines = table.split('\n').filter((l) => /ci|export/.test(l));
    expect(ciLines.join('\n')).not.toMatch(/ingest|result|push/i);
    for (const url of ['/ci/runs', '/ci/results', `/agents/${ID}/ci/result`]) {
      const res = await app.inject({ method: 'PUT', url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
    // The only mutating ci route besides export/update is the GitHub-pulling refresh: it takes no body.
    expect((await app.inject({ method: 'POST', url: '/ci/results', payload: {} })).statusCode).toBe(404);
    await app.close();
  });

  it('the committed runner bundle loads and carries the template header', async () => {
    const bundle = await loadRunnerBundle();
    expect(bundle.split('\n').slice(0, 3).join('\n')).toContain('devdigest-ci/v1');
  });
});
