import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { CiService } from '../src/modules/ci/service.js';
import { CiRunsService } from '../src/modules/ci/ingest.js';
import type { CiDeps } from '../src/modules/ci/ports.js';
import { buildWorkflow } from '../src/modules/ci/generate.js';
import { ConfigError, ConflictError, ExternalServiceError, NotFoundError, ValidationError } from '../src/platform/errors.js';
import { FakeCiRepo, WS, exportAgent } from './helpers/ci.js';

const TOKEN = 'ghp_SUPERSECRETTOKENVALUE0123456789';
const WORKFLOW = '.github/workflows/devdigest-review.yml';

function setup(opts: { github?: ConstructorParameters<typeof MockGitHubClient>[0]; token?: boolean; now?: Date } = {}) {
  const repo = new FakeCiRepo();
  const github = new MockGitHubClient(opts.github);
  let now = opts.now ?? new Date('2026-10-31T12:00:00Z');
  const deps: CiDeps = {
    repo,
    github: async () => {
      if (opts.token === false) throw new ConfigError('GITHUB_TOKEN is not configured');
      return github;
    },
    hasGithubToken: async () => opts.token !== false,
    runnerBundle: async () => '// devdigest-ci/v1 runner',
    now: () => now,
  };
  return {
    repo,
    github,
    service: new CiService(deps),
    runs: new CiRunsService(deps),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
  };
}

const input = { repo: 'acme/api', target: 'gha', action: 'open_pr', post_as: 'github_review', triggers: ['opened', 'synchronize'], confirm_overwrite: false, confirm_secret_warning: false } as const;
const fgErr = (extra: object) => Object.assign(new Error('Resource not accessible by personal access token'), { status: 403, tokenKind: 'unknown', ...extra });

describe('preview', () => {
  it('returns the files and an absent workflow state', async () => {
    const { service } = setup();
    const p = await service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'github_review', triggers: ['opened'] });
    expect(p.files.at(-1)!.path).toBe(WORKFLOW);
    expect(p.workflow_state).toBe('absent');
    expect(p.studio_token).toBe(true);
    expect(JSON.stringify(p)).not.toContain(TOKEN);
  });
  it('reports whether the target repo is public and how many memory rows were dropped', async () => {
    const pub = setup({ github: { repoPrivate: false } });
    pub.repo.memory = [
      { id: 'm1', scope: 'global', kind: 'fact', content: 'plain' },
      { id: 'm2', scope: 'global', kind: 'fact', content: 'token: ghp_abcdefghijklmnopqrstuvwxyz0123' },
    ];
    const p = await pub.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] });
    expect(p.repo_public).toBe(true);
    expect(p.memory).toEqual({ included: 1, total: 1, dropped: 1 });
    const priv = setup({ github: { repoPrivate: true } });
    expect((await priv.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).repo_public).toBe(false);
    expect((await setup({ token: false }).service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).repo_public).toBeNull();
  });

  it('marks a foreign / devdigest workflow, and unknown without a token or on error', async () => {
    const foreign = setup({ github: { optionalFiles: { [WORKFLOW]: 'name: mine\n' } } });
    expect((await foreign.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).workflow_state).toBe('foreign');
    const mine = setup({ github: { optionalFiles: { [WORKFLOW]: '# devdigest-ci/v1\nname: x\n' } } });
    expect((await mine.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).workflow_state).toBe('devdigest');
    const noToken = setup({ token: false });
    const p = await noToken.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] });
    expect(p).toMatchObject({ workflow_state: 'unknown', studio_token: false });
    const broken = setup({ github: { failures: { getOptionalFileContent: fgErr({}) } } });
    expect((await broken.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).workflow_state).toBe('unknown');
  });
  it('refuses a non-openrouter provider (AC-5), unknown repo and bad repo format', async () => {
    const s = setup();
    s.repo.agent = exportAgent({ provider: 'openai' });
    await expect(s.service.preview(WS, 'agent-1', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).rejects.toThrow(ValidationError);
    s.repo.agent = exportAgent();
    await expect(s.service.preview(WS, 'agent-1', { repo: 'acme/other', post_as: 'none', triggers: ['opened'] })).rejects.toThrow(NotFoundError);
    await expect(s.service.preview(WS, 'agent-1', { repo: 'a b/../c', post_as: 'none', triggers: ['opened'] })).rejects.toThrow(ValidationError);
    await expect(s.service.preview(WS, 'nope', { repo: 'acme/api', post_as: 'none', triggers: ['opened'] })).rejects.toThrow(NotFoundError);
  });
});

describe('secrets (AC-19..22, EC-8, EC-9)', () => {
  const status = async (github: object | undefined, token = true) => {
    const s = setup({ github: github as never, token });
    const v = await s.service.secrets(WS, 'agent-1', 'acme/api');
    expect(v.secrets[0]).toEqual({ name: 'GITHUB_TOKEN', state: 'ready', reason: null });
    return v.secrets[1]!;
  };
  it('ready when in the repo or the org list', async () => {
    expect((await status({ actionSecrets: { repo: ['OPENROUTER_API_KEY'], org: [], has_environments: false } })).state).toBe('ready');
    expect((await status({ actionSecrets: { repo: [], org: ['OPENROUTER_API_KEY'], has_environments: false } })).state).toBe('ready');
  });
  it('not_set only when the lists were read and it is absent', async () => {
    expect((await status({ actionSecrets: { repo: [], org: [], has_environments: false } })).state).toBe('not_set');
    expect((await status({ actionSecrets: { repo: [], org: null, has_environments: false } })).state).toBe('not_set');
  });
  it('unknown with a reason for unreadable org list, environments, 403, network, rate limit, no token', async () => {
    expect((await status({ actionSecrets: { repo: [], org: null, org_unreadable: true, has_environments: false } })).state).toBe('unknown');
    expect((await status({ actionSecrets: { repo: [], org: [], has_environments: true } })).state).toBe('unknown');
    const forbidden = await status({ failures: { listActionsSecretNames: fgErr({}) } });
    expect(forbidden).toMatchObject({ state: 'unknown' });
    expect(forbidden.reason).toContain('Secrets: read');
    expect((await status({ failures: { listActionsSecretNames: new Error('ECONNRESET') } })).state).toBe('unknown');
    const limited = await status({ failures: { listActionsSecretNames: fgErr({ retryAfterMs: 1000 }) } });
    expect(limited.reason).toContain('rate limit');
    expect((await status(undefined, false)).state).toBe('unknown');
  });
});

describe('exportCi (AC-28..33, EC-2)', () => {
  it('one commit to devdigest/ci from the live default branch, one PR, one installation + event', async () => {
    const s = setup({ github: { defaultBranch: 'trunk' } });
    const out = await s.service.exportCi(WS, 'agent-1', { ...input });
    const commits = s.github.calls.filter((c) => c.method === 'commitFiles');
    expect(commits).toEqual([{ method: 'commitFiles', branch: 'devdigest/ci', base: 'trunk' }]);
    expect(s.github.committed[0]!.message).toBe('Add DevDigest CI review');
    expect(s.github.committed[0]!.files.map((f) => f.path)).toContain(WORKFLOW);
    expect(s.github.openedPrs).toEqual([
      expect.objectContaining({ title: 'Add DevDigest CI review', head: 'devdigest/ci', base: 'trunk' }),
    ]);
    expect(out.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(s.repo.installations).toHaveLength(1);
    expect(s.repo.events).toEqual([expect.objectContaining({ action: 'install', outcome: 'succeeded' })]);
    expect(out.installation).toMatchObject({ repo: 'acme/api', pr_number: 1, workflow_version: 'devdigest-ci/v1', last_export_outcome: 'succeeded' });
  });

  it('reuses an open PR instead of opening a second one (AC-30)', async () => {
    const s = setup({ github: { existingPr: { url: 'https://github.com/acme/api/pull/9', number: 9 } } });
    const out = await s.service.exportCi(WS, 'agent-1', { ...input });
    expect(s.github.openedPrs).toHaveLength(0);
    expect(out.pr_url).toBe('https://github.com/acme/api/pull/9');
    expect(s.repo.installations[0]!.prNumber).toBe(9);
  });

  it('a double export keeps one installation and adds at most one more commit (EC-2)', async () => {
    const s = setup();
    await s.service.exportCi(WS, 'agent-1', { ...input });
    await s.service.exportCi(WS, 'agent-1', { ...input });
    expect(s.repo.installations).toHaveLength(1);
    expect(s.github.openedPrs).toHaveLength(1);
    expect(s.github.committed).toHaveLength(2);
  });

  it('a foreign workflow needs confirm_overwrite (409), then goes through', async () => {
    const s = setup({ github: { optionalFiles: { [WORKFLOW]: 'name: mine\n' } } });
    await expect(s.service.exportCi(WS, 'agent-1', { ...input })).rejects.toThrow(ConflictError);
    expect(s.github.committed).toHaveLength(0);
    expect(s.repo.installations).toHaveLength(0);
    await s.service.exportCi(WS, 'agent-1', { ...input, confirm_overwrite: true });
    expect(s.github.committed).toHaveLength(1);
  });

  it('writes the edited workflow verbatim after a YAML parse; invalid YAML is a 422', async () => {
    const s = setup();
    await expect(s.service.exportCi(WS, 'agent-1', { ...input, workflow: 'a: [1,\n' })).rejects.toThrow(ValidationError);
    expect(s.github.committed).toHaveLength(0);
    const edited = '# devdigest-ci/v1 edited\non: push\n';
    const out = await s.service.exportCi(WS, 'agent-1', { ...input, workflow: edited });
    expect(s.github.committed[0]!.files.find((f) => f.path === WORKFLOW)!.contents).toBe(edited);
    expect(out.files.find((f) => f.path === WORKFLOW)!.contents).toBe(edited);
  });

  it('an edited workflow with key-like text needs confirm_secret_warning (server-side)', async () => {
    const s = setup();
    const leaky = '# devdigest-ci/v1\non: push\nenv:\n  X: sk-or-v1-abcdef1234567890\n';
    const err = await s.service.exportCi(WS, 'agent-1', { ...input, workflow: leaky }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(s.github.committed).toHaveLength(0);
    expect(s.repo.installations).toHaveLength(0);
    const ok = await s.service.exportCi(WS, 'agent-1', { ...input, workflow: leaky, confirm_secret_warning: true });
    expect(ok.pr_url).toBeTruthy();
    expect(s.github.committed[0]!.files.find((f) => f.path === WORKFLOW)!.contents).toBe(leaky);
  });

  it('refuses without a studio token (AC-32) and for a non-openrouter agent (AC-5)', async () => {
    await expect(setup({ token: false }).service.exportCi(WS, 'agent-1', { ...input })).rejects.toThrow(ConfigError);
    const s = setup();
    s.repo.agent = exportAgent({ provider: 'anthropic' });
    await expect(s.service.exportCi(WS, 'agent-1', { ...input })).rejects.toThrow(ValidationError);
  });

  it('a fine-grained 403 names the permission and records no installation (AC-33)', async () => {
    const s = setup({
      github: { failures: { commitFiles: fgErr({ tokenKind: 'fine_grained', acceptedPermissions: [['contents=write', 'workflows=write']] }) } },
    });
    const err = await s.service.exportCi(WS, 'agent-1', { ...input }).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.details.missing_permission).toBe('Contents: write + Workflows: write');
    expect(err.message).toContain('Workflows: write');
    expect(s.repo.installations).toHaveLength(0);
    expect(s.repo.events).toHaveLength(0);
  });

  it('a classic 403 names the scope; a 404 names no permission', async () => {
    const classic = setup({
      github: { failures: { commitFiles: fgErr({ tokenKind: 'classic', oauthScopes: ['repo'], acceptedOauthScopes: ['repo', 'workflow'] }) } },
    });
    const err = await classic.service.exportCi(WS, 'agent-1', { ...input }).catch((e) => e);
    expect(err.details.missing_permission).toBe('`workflow` scope');
    const nf = setup({ github: { failures: { getRepoInfo: Object.assign(new Error('Not Found'), { status: 404, tokenKind: 'unknown' }) } } });
    const e404 = await nf.service.exportCi(WS, 'agent-1', { ...input }).catch((e) => e);
    expect(e404.details).toEqual({ status: 404, missing_permission: null });
  });

  it('a failure on an existing installation records a failed event', async () => {
    const s = setup();
    await s.service.exportCi(WS, 'agent-1', { ...input });
    s.github = undefined as never;
    const s2 = setup({ github: { failures: { commitFiles: fgErr({}) } } });
    s2.repo.installations = s.repo.installations;
    await expect(s2.service.exportCi(WS, 'agent-1', { ...input })).rejects.toThrow(ExternalServiceError);
    expect(s2.repo.events.at(-1)).toMatchObject({ action: 'install', outcome: 'failed' });
    expect(s2.repo.installations).toHaveLength(1);
  });

  it('opening the PR races: a 422 "already exists" reuses the PR (EC-2)', async () => {
    const s = setup({ github: { failures: { openPullRequest: Object.assign(new Error('A pull request already exists'), { status: 422, tokenKind: 'unknown' }) } } });
    const orig = s.github.findOpenPr.bind(s.github);
    let n = 0;
    s.github.findOpenPr = async (r, b) => (++n === 1 ? null : { url: 'https://github.com/acme/api/pull/3', number: 3 }) ?? orig(r, b);
    const out = await s.service.exportCi(WS, 'agent-1', { ...input });
    expect(out.pr_url).toBe('https://github.com/acme/api/pull/3');
  });

  it('never writes to any branch but devdigest/ci, across install and update (AC-29)', async () => {
    const s = setup();
    const out = await s.service.exportCi(WS, 'agent-1', { ...input });
    await s.service.update(WS, 'agent-1', out.installation.id);
    const writes = s.github.calls.filter((c) => c.method === 'commitFiles');
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.every((c) => c.branch === 'devdigest/ci' && c.base === 'main')).toBe(true);
    expect(s.github.calls.filter((c) => c.method === 'openPullRequest').every((c) => c.branch === 'devdigest/ci')).toBe(true);
  });

  it('the token never appears in responses or mapped errors (AC-71)', async () => {
    const s = setup({ github: { failures: { commitFiles: fgErr({}) } } });
    const err = await s.service.exportCi(WS, 'agent-1', { ...input }).catch((e) => e);
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(TOKEN);
    const ok = setup();
    const out = await ok.service.exportCi(WS, 'agent-1', { ...input });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });
});

describe('installations and update (AC-36..41)', () => {
  it('marks out of date after a config change and counts merged PRs as active', async () => {
    const s = setup({ github: { pullStates: { 1: 'merged' } } });
    await s.service.exportCi(WS, 'agent-1', { ...input });
    let view = await s.service.installations(WS, 'agent-1');
    expect(view.installations[0]).toMatchObject({ out_of_date: false, pr_state: 'merged', pr_state_stale: false });
    expect(view.active_count).toBe(1);
    s.repo.agent = exportAgent({ ciFailOn: 'any' });
    view = await s.service.installations(WS, 'agent-1');
    expect(view.installations[0]!.out_of_date).toBe(true);
  });

  it('a template version difference is out of date', async () => {
    const s = setup();
    await s.service.exportCi(WS, 'agent-1', { ...input });
    s.repo.installations[0]!.workflowVersion = 'devdigest-ci/v0';
    expect((await s.service.installations(WS, 'agent-1')).installations[0]!.out_of_date).toBe(true);
  });

  it('keeps the last known PR state, marked stale, when GitHub cannot be read (AC-37)', async () => {
    const s = setup();
    await s.service.exportCi(WS, 'agent-1', { ...input });
    const failing = setup({ github: { failures: { getPullState: new Error('network') } } });
    failing.repo.installations = s.repo.installations;
    const view = await failing.service.installations(WS, 'agent-1');
    expect(view.installations[0]).toMatchObject({ pr_state: 'open', pr_state_stale: true });
    const noToken = setup({ token: false });
    noToken.repo.installations = s.repo.installations;
    expect((await noToken.service.installations(WS, 'agent-1')).installations[0]!.pr_state_stale).toBe(true);
  });

  it('update regenerates all files incl. the workflow from stored options, reuses the PR, records an update event', async () => {
    const s = setup();
    const out = await s.service.exportCi(WS, 'agent-1', { ...input, post_as: 'pr_comment', triggers: ['reopened'], workflow: '# devdigest-ci/v1\non: push\n' });
    s.repo.agent = exportAgent({ ciFailOn: 'warning' });
    const res = await s.service.update(WS, 'agent-1', out.installation.id);
    expect(res.error).toBeNull();
    const last = s.github.committed.at(-1)!;
    expect(last.message).toBe('Update DevDigest CI config');
    expect(last.files.find((f) => f.path === WORKFLOW)!.contents).toBe(
      buildWorkflow({ postAs: 'pr_comment', triggers: ['reopened'], agentSlug: 'security-reviewer' }),
    );
    expect(s.github.openedPrs).toHaveLength(1);
    expect(s.repo.events.at(-1)).toMatchObject({ action: 'update', outcome: 'succeeded' });
    expect(res.installation.out_of_date).toBe(false);
  });

  it('update opens a titled PR when none is open and survives a deleted branch (EC-4)', async () => {
    const s = setup();
    const out = await s.service.exportCi(WS, 'agent-1', { ...input });
    s.github.openedPrs.length = 0;
    await s.service.update(WS, 'agent-1', out.installation.id);
    expect(s.github.openedPrs[0]!.title).toBe('Update DevDigest CI config');
  });

  it('update reports a GitHub failure in the result and records a failed event', async () => {
    const s = setup();
    const out = await s.service.exportCi(WS, 'agent-1', { ...input });
    s.github = new MockGitHubClient({ failures: { commitFiles: fgErr({}) } });
    const failing = new CiService({
      repo: s.repo,
      github: async () => s.github,
      hasGithubToken: async () => true,
      runnerBundle: async () => 'x',
      now: () => new Date(),
    });
    const res = await failing.update(WS, 'agent-1', out.installation.id);
    expect(res.error).toBeTruthy();
    expect(res.installation.out_of_date).toBe(true);
    expect(s.repo.events.at(-1)).toMatchObject({ action: 'update', outcome: 'failed' });
  });

  it('update of an unknown installation is a 404', async () => {
    await expect(setup().service.update(WS, 'agent-1', 'nope')).rejects.toThrow(NotFoundError);
  });
});

const artifact = (over: object = {}) =>
  zipSync({
    'devdigest-result.json': new TextEncoder().encode(
      JSON.stringify({ findings_count: 1, critical: 1, warning: 0, suggestion: 0, cost_usd: 0.01, duration_ms: 900, agent: 'A', version: 'devdigest-ci/v1', pr_number: 5, verdict: 'request_changes', blockers: 1, model: 'm', ...over }),
    ),
  });
const wfRun = (id: number, over: object = {}) => ({
  id,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  html_url: `https://github.com/acme/api/actions/runs/${id}`,
  pr_numbers: [5],
  created_at: '2026-10-31T10:00:00Z',
  run_started_at: '2026-10-31T10:00:01Z',
  updated_at: '2026-10-31T10:00:30Z',
  ...over,
});

describe('ingest (AC-52..61, AC-68)', () => {
  async function installed(github: ConstructorParameters<typeof MockGitHubClient>[0]) {
    const s = setup({ github });
    await s.repo.upsertInstallation(WS, 'agent-1', { repo: 'acme/api', configHash: 'h', workflowVersion: 'devdigest-ci/v1', postAs: 'github_review', triggers: ['opened'], prUrl: null, prNumber: null });
    return s;
  }

  it('ingests completed runs once, shows in-progress runs as running without storing them', async () => {
    const s = await installed({
      workflowRuns: [wfRun(1), wfRun(2, { status: 'in_progress', conclusion: null })],
      artifacts: { 1: artifact() },
    });
    const first = await s.runs.refresh(WS);
    expect(first.ingested).toBe(1);
    expect(first.running).toHaveLength(1);
    expect(first.running[0]).toMatchObject({ status: 'running', pr_number: 5 });
    expect(s.repo.runs).toHaveLength(1);
    expect(s.repo.runs[0]!.agentRun.status).toBe('done');
    const again = await s.runs.refresh(WS);
    expect(again.ingested).toBe(0);
    expect(s.repo.runs).toHaveLength(1);
  });

  it('a new attempt is a new row (AC-55)', async () => {
    const s = await installed({ workflowRuns: [wfRun(1), wfRun(1, { run_attempt: 2 })], artifacts: { 1: artifact() } });
    expect((await s.runs.refresh(WS)).ingested).toBe(2);
  });

  it('missing, too large and invalid artifacts become failed rows with null counts', async () => {
    const s = await installed({
      workflowRuns: [wfRun(1), wfRun(2), wfRun(3)],
      artifacts: { 2: 'too_large', 3: artifact({ cost_usd: 99999 }) },
    });
    await s.runs.refresh(WS);
    expect(s.repo.runs).toHaveLength(3);
    for (const r of s.repo.runs) {
      expect(r.ci).toMatchObject({ status: 'failed', findingsCount: null });
      expect(r.ci.error).toBeTruthy();
      expect(r.agentRun.status).toBe('failed');
    }
  });

  it('rate limit: stops, returns retry_at and makes no GitHub call until then', async () => {
    const s = await installed({ failures: { listWorkflowRuns: fgErr({ status: 429, retryAfterMs: 30_000 }) } });
    const first = await s.runs.refresh(WS);
    expect(first.retry_at).toBe('2026-10-31T12:00:30.000Z');
    const calls = s.github.calls.length;
    const second = await s.runs.refresh(WS);
    expect(second).toMatchObject({ ingested: 0, retry_at: '2026-10-31T12:00:30.000Z' });
    expect(s.github.calls.length).toBe(calls);
    s.advance(31_000);
    await s.runs.refresh(WS);
    expect(s.github.calls.length).toBeGreaterThan(calls);
  });

  it('other per-repo errors go to errors[] and do not stop the loop', async () => {
    const s = await installed({ failures: { listWorkflowRuns: Object.assign(new Error('Not Found'), { status: 404, tokenKind: 'unknown' }) } });
    const out = await s.runs.refresh(WS);
    expect(out.errors).toEqual([{ repo: 'acme/api', message: expect.stringContaining('Not Found') }]);
    expect(out.retry_at).toBeNull();
  });

  it('no token: reports it without a GitHub call; no installations: nothing to do', async () => {
    const s = setup({ token: false });
    expect((await s.runs.refresh(WS)).errors).toEqual([]);
    await s.repo.upsertInstallation(WS, 'agent-1', { repo: 'acme/api', configHash: 'h', workflowVersion: 'v', postAs: 'none', triggers: ['opened'], prUrl: null, prNumber: null });
    expect((await s.runs.refresh(WS)).errors[0]!.message).toContain('GitHub token');
  });
});
