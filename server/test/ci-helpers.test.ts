import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
  ciRunStatus,
  configHash,
  hasDevdigestHeader,
  looksLikeSecret,
  mapGitHubError,
  parseArtifact,
  rateLimitWaitMs,
  toRunRows,
  uniqueSlugs,
  validateWorkflowYaml,
} from '../src/modules/ci/helpers.js';
import { buildFiles } from '../src/modules/ci/generate.js';
import type { ExportAgent } from '../src/modules/ci/ports.js';

const agent: ExportAgent = {
  id: 'a',
  name: 'Agent',
  provider: 'openrouter',
  model: 'm',
  systemPrompt: 'prompt',
  strategy: 'auto',
  ciFailOn: 'critical',
  skills: [{ id: 's', name: 'Rule', body: 'body' }],
};
const files = (over: Partial<ExportAgent> = {}, memory = ['one']) =>
  buildFiles({
    agent: { ...agent, ...over },
    memoryRows: memory.map((c, i) => ({ id: `m${i}`, scope: 'global', kind: 'fact', content: c })),
    runnerBundle: 'runner',
    postAs: 'github_review',
    triggers: ['opened', 'synchronize'],
  }).files;

describe('slugs', () => {
  it('suffixes collisions in order', () => {
    expect(uniqueSlugs(['A b', 'a-b', 'A  B!'])).toEqual(['a-b', 'a-b-2', 'a-b-3']);
    expect(uniqueSlugs(['!!!'])).toEqual(['skill']);
  });
});

describe('configHash (AC-38, AC-44, EC-18)', () => {
  const base = configHash(files());
  it('is stable', () => expect(configHash(files())).toBe(base));
  it('changes with ci_fail_on, prompt, skill body and memory', () => {
    expect(configHash(files({ ciFailOn: 'any' }))).not.toBe(base);
    expect(configHash(files({ systemPrompt: 'other' }))).not.toBe(base);
    expect(configHash(files({ skills: [{ id: 's', name: 'Rule', body: 'changed' }] }))).not.toBe(base);
    expect(configHash(files({}, ['one', 'two']))).not.toBe(base);
  });
  it('ignores the editable workflow', () => {
    const f = files().map((x) => (x.editable ? { ...x, contents: 'edited' } : x));
    expect(configHash(f)).toBe(base);
  });
});

describe('workflow checks', () => {
  it('detects the header', () => {
    expect(hasDevdigestHeader('# devdigest-ci/v1 · generated\nname: x')).toBe(true);
    expect(hasDevdigestHeader('name: other')).toBe(false);
  });
  it('flags key-like text', () => {
    expect(looksLikeSecret('key: sk-or-v1-abcdef123456')).toBe(true);
    expect(looksLikeSecret('token: ghp_abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(looksLikeSecret('github_pat_11AAAAAAAAAAAAAAAAAAAA')).toBe(true);
    expect(looksLikeSecret('AKIAABCDEFGHIJKLMNOP')).toBe(true);
    expect(looksLikeSecret('api_key = "abcdef0123456789abcdef0123456789"')).toBe(true);
    expect(looksLikeSecret('OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}')).toBe(false);
  });
  it('validates YAML', () => {
    expect(validateWorkflowYaml('on: push\n').ok).toBe(true);
    const bad = validateWorkflowYaml('a: [1, 2\n');
    expect(bad.ok).toBe(false);
    expect(validateWorkflowYaml('just text').ok).toBe(false);
  });
});

describe('mapGitHubError (D5, EC-1)', () => {
  const err = (e: object) => ({ status: 403, message: 'Resource not accessible', tokenKind: 'unknown', ...e });
  it('fine-grained header names the permission', () => {
    const m = mapGitHubError(err({ tokenKind: 'fine_grained', acceptedPermissions: [['workflows=write']] }), 'write_files');
    expect(m.missingPermission).toBe('Workflows: write');
  });
  it('classic accepted scopes minus held scopes names the scope', () => {
    const m = mapGitHubError(
      err({ tokenKind: 'classic', oauthScopes: ['repo'], acceptedOauthScopes: ['repo', 'workflow'] }),
      'write_files',
    );
    expect(m.missingPermission).toBe('`workflow` scope');
  });
  it('falls back to the table per token kind when no header names it', () => {
    expect(mapGitHubError(err({}), 'write_files').missingPermission).toBe('Contents: write + Workflows: write');
    expect(mapGitHubError(err({ tokenKind: 'classic' }), 'write_files').missingPermission).toBe(
      '`repo` + `workflow` scope',
    );
    expect(mapGitHubError(err({}), 'open_pr').missingPermission).toBe('Pull requests: write');
    expect(mapGitHubError(err({}), 'list_secrets').missingPermission).toBe('Secrets: read');
    expect(mapGitHubError(err({}), 'read_runs').missingPermission).toBe('Actions: read');
  });
  it('a bare 404 never names a permission', () => {
    const m = mapGitHubError({ status: 404, message: 'Not Found', tokenKind: 'unknown' }, 'write_files');
    expect(m.missingPermission).toBeNull();
    expect(m.message).toContain('not found, or the token cannot see it');
  });
  it('422, 409 and non-GitHub errors name nothing', () => {
    expect(mapGitHubError({ status: 422, message: 'Validation Failed', tokenKind: 'unknown' }, 'open_pr').missingPermission).toBeNull();
    expect(mapGitHubError({ status: 409, message: 'Conflict', tokenKind: 'unknown' }, 'write_files').missingPermission).toBeNull();
    expect(mapGitHubError(new Error('boom'), 'write_files')).toMatchObject({ status: 502, missingPermission: null });
  });
  it('a rate limited 403 is not a missing permission and yields a wait', () => {
    const e = err({ retryAfterMs: 5000 });
    expect(mapGitHubError(e, 'read_runs').missingPermission).toBeNull();
    expect(rateLimitWaitMs(e)).toBe(5000);
    expect(rateLimitWaitMs({ status: 429, message: 'x', tokenKind: 'unknown' })).toBe(60_000);
    expect(rateLimitWaitMs(err({}))).toBeNull();
  });
});

describe('ciRunStatus (AC-62)', () => {
  it('maps conclusion and findings', () => {
    expect(ciRunStatus('success', 0)).toBe('no_findings');
    expect(ciRunStatus('success', 3)).toBe('succeeded');
    expect(ciRunStatus('failure', 3)).toBe('failed');
    expect(ciRunStatus('cancelled', 0)).toBe('failed');
    expect(ciRunStatus(null, 0)).toBe('failed');
  });
});

const artifactJson = {
  findings_count: 2,
  critical: 1,
  warning: 1,
  suggestion: 0,
  cost_usd: 0.02,
  duration_ms: 1200,
  agent: 'Agent',
  version: 'devdigest-ci/v1',
  pr_number: 7,
  verdict: 'request_changes',
  blockers: 1,
  model: 'm/x',
};
const zipOf = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, new TextEncoder().encode(v)])));

describe('parseArtifact (AC-54, EC-13, EC-14)', () => {
  it('accepts a valid artifact', () => {
    const r = parseArtifact(zipOf({ 'devdigest-result.json': JSON.stringify(artifactJson) }));
    expect(r).toMatchObject({ ok: true });
  });
  it('rejects missing file, extra-only files, invalid json, schema mismatch, non-zip', () => {
    expect(parseArtifact(zipOf({ 'other.json': '{}' })).ok).toBe(false);
    expect(parseArtifact(zipOf({ 'devdigest-result.json': 'nope' })).ok).toBe(false);
    expect(parseArtifact(zipOf({ 'devdigest-result.json': '{"findings_count":1}' })).ok).toBe(false);
    expect(parseArtifact(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });
  it('rejects an oversize inflated file before inflating it', () => {
    const big = JSON.stringify({ ...artifactJson, agent: 'x'.repeat(1_100_000) });
    const r = parseArtifact(zipOf({ 'devdigest-result.json': big }));
    expect(r).toEqual({ ok: false, error: expect.stringContaining('larger than 1 MB') });
  });
  it('bounds the real inflated bytes, not the zip header size (zip bomb)', () => {
    const real = new Uint8Array(5 * 1024 * 1024); // 5 MB of zeros: tiny once deflated
    const zip = zipSync({ 'devdigest-result.json': [real, { level: 9 }] });
    expect(zip.length).toBeLessThan(100_000);
    // Forge the header: local (offset 22) and central directory (offset 24) uncompressed size = 100.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 30 < zip.length; i++) {
      const sig = view.getUint32(i, true);
      if (sig === 0x04034b50) view.setUint32(i + 22, 100, true);
      if (sig === 0x02014b50) view.setUint32(i + 24, 100, true);
    }
    const r = parseArtifact(zip);
    expect(r).toEqual({ ok: false, error: expect.stringContaining('larger than 1 MB') });
  });
  it('accepts a stored (uncompressed) entry', () => {
    const body = new TextEncoder().encode(JSON.stringify(artifactJson));
    expect(parseArtifact(zipSync({ 'devdigest-result.json': [body, { level: 0 }] })).ok).toBe(true);
  });
  it('rejects forged out-of-bound numbers', () => {
    for (const forged of [
      { findings_count: 99_999 },
      { cost_usd: 1e9 },
      { duration_ms: 1e12 },
      { findings_count: -1 },
      { agent: 'x'.repeat(300) },
    ]) {
      const r = parseArtifact(zipOf({ 'devdigest-result.json': JSON.stringify({ ...artifactJson, ...forged }) }));
      expect(r.ok).toBe(false);
    }
  });
});

describe('toRunRows (AC-56..60)', () => {
  const run = {
    id: 99,
    run_attempt: 2,
    status: 'completed',
    conclusion: 'failure',
    html_url: 'https://github.com/o/r/actions/runs/99',
    pr_numbers: [12],
    created_at: '2026-10-31T10:00:00Z',
    run_started_at: '2026-10-31T10:00:05Z',
    updated_at: '2026-10-31T10:01:05Z',
  };
  const inst = { id: 'i1', agentId: 'ag1' };
  const ok = { ok: true as const, artifact: artifactJson as never };

  it('valid artifact on a gate failure: ci failed, agent run done, job url from API, no pr_id', () => {
    const { ci, agentRun } = toRunRows(inst, run, { ok: true, artifact: { ...artifactJson } as never });
    expect(ci).toMatchObject({
      status: 'failed',
      githubUrl: run.html_url,
      githubRunId: 99,
      runAttempt: 2,
      prNumber: 12,
      durationMs: 60_000,
      findingsCount: 2,
      blockers: 1,
      verdict: 'request_changes',
    });
    expect(agentRun).toMatchObject({ status: 'done', provider: 'openrouter', model: 'm/x', findingsCount: 2, durationMs: 1200 });
    expect(agentRun).not.toHaveProperty('prId');
  });
  it('job success with findings is succeeded; zero findings is no_findings', () => {
    expect(toRunRows(inst, { ...run, conclusion: 'success' }, ok).ci.status).toBe('succeeded');
    const zero = { ok: true as const, artifact: { ...artifactJson, findings_count: 0 } as never };
    expect(toRunRows(inst, { ...run, conclusion: 'success' }, zero).ci.status).toBe('no_findings');
  });
  it('invalid artifact: failed with null counts and an error, never running', () => {
    const { ci, agentRun } = toRunRows(inst, { ...run, conclusion: 'success' }, { ok: false, error: 'missing' });
    expect(ci).toMatchObject({ status: 'failed', findingsCount: null, costUsd: null, verdict: null, error: 'missing' });
    expect(agentRun).toMatchObject({ status: 'failed', findingsCount: null, error: 'missing' });
  });
  it('PR number falls back to the artifact for fork PRs', () => {
    expect(toRunRows(inst, { ...run, pr_numbers: [] }, ok).ci.prNumber).toBe(7);
  });
});
