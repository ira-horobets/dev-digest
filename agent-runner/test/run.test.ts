import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CiResultArtifact } from '@devdigest/shared';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { main } from '../src/main.js';
import {
  CRITICAL_FINDING,
  WARNING_FINDING,
  diffRaw,
  fakeGitHub,
  makeWorkDir,
  reviewFixture,
} from './helpers/fixture.js';

async function run(opts: {
  findings: unknown[];
  ciFailOn?: string;
  postAs?: string;
  reviewStatuses?: number[];
  commentStatus?: number;
  key?: string;
}) {
  const work = await makeWorkDir({ ciFailOn: opts.ciFailOn });
  const api = fakeGitHub(await diffRaw(), opts);
  const logs: string[] = [];
  const llm = new MockLLMProvider('openai', { structured: reviewFixture(opts.findings) });
  const code = await main({
    env: {
      ...work.env,
      DEVDIGEST_POST_AS: opts.postAs ?? 'github_review',
      OPENROUTER_API_KEY: opts.key ?? work.env.OPENROUTER_API_KEY!,
    },
    cwd: work.cwd,
    fetchImpl: api.fetchImpl,
    llm,
    log: (l) => logs.push(l),
  });
  const artifact = await readFile(path.join(work.cwd, 'devdigest-result.json'), 'utf8').then(
    (t) => JSON.parse(t),
    () => null,
  );
  return { code, api, logs, artifact, work };
}

describe('runner main (fake fetch + stub LLM)', () => {
  it('review mode, gate tripped: one REQUEST_CHANGES review with inline comments, exit 1, valid artifact', async () => {
    const r = await run({ findings: [CRITICAL_FINDING] });
    expect(r.code).toBe(1);
    const posts = r.api.writes();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://api.github.test/repos/acme/api/pulls/7/reviews');
    expect(posts[0]!.body.event).toBe('REQUEST_CHANGES');
    expect(posts[0]!.body.comments).toHaveLength(1);
    expect(posts[0]!.authorization).toBe('Bearer ghs_testtoken');
    const parsed = CiResultArtifact.parse(r.artifact);
    expect(parsed).toMatchObject({
      findings_count: 1,
      critical: 1,
      verdict: 'request_changes',
      blockers: 1,
      pr_number: 7,
    });
    expect(parsed.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('gate off (warning only, fail on critical): COMMENT review, exit 0 (AC-49)', async () => {
    const r = await run({ findings: [WARNING_FINDING] });
    expect(r.code).toBe(0);
    expect(r.api.writes()[0]!.body.event).toBe('COMMENT');
    expect(r.artifact.verdict).toBe('comment');
    expect(r.artifact.blockers).toBe(0);
  });

  it('zero findings: COMMENT (never APPROVE), exit 0', async () => {
    const r = await run({ findings: [] });
    expect(r.code).toBe(0);
    const posts = r.api.writes();
    expect(posts[0]!.body.event).toBe('COMMENT');
    expect(posts[0]!.body.body).not.toContain('Approved');
    expect(JSON.stringify(r.api.requests)).not.toContain('APPROVE');
    expect(r.artifact.verdict).toBe('approve');
  });

  it('pr_comment mode posts one issue comment and no review', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], postAs: 'pr_comment' });
    const posts = r.api.writes();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toMatch(/\/issues\/7\/comments$/);
    expect(r.code).toBe(1);
  });

  it('none mode posts nothing but still writes the artifact and the gate exit code', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], postAs: 'none' });
    expect(r.api.writes()).toHaveLength(0);
    expect(r.artifact.findings_count).toBe(1);
    expect(r.code).toBe(1);
  });

  it('ci_fail_on never never fails the check', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], ciFailOn: 'never' });
    expect(r.code).toBe(0);
    expect(r.api.writes()[0]!.body.event).toBe('COMMENT');
  });

  it('REQUEST_CHANGES rejected with 403 -> retried as a COMMENT review; exit code stays 1 (D12)', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], reviewStatuses: [403, 200] });
    const posts = r.api.writes();
    expect(posts.map((p) => p.body.event)).toEqual(['REQUEST_CHANGES', 'COMMENT']);
    expect(posts[1]!.body.body).toBe(posts[0]!.body.body);
    expect(r.code).toBe(1);
    expect(r.logs.join('\n')).toContain('Workflow permissions');
  });

  it('both reviews rejected -> exactly one PR comment, exit code stays 1', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], reviewStatuses: [422, 403] });
    const posts = r.api.writes();
    expect(posts).toHaveLength(3);
    expect(posts.filter((p) => p.url.endsWith('/issues/7/comments'))).toHaveLength(1);
    expect(r.code).toBe(1);
    expect(r.artifact).not.toBeNull();
  });

  it('a non-403/422 posting error logs and keeps the gate exit code', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], reviewStatuses: [500] });
    expect(r.code).toBe(1);
    expect(r.logs.join('\n')).toContain('Could not post');
    expect(r.artifact).not.toBeNull();
  });

  it('empty OPENROUTER_API_KEY: exit 2, names the secret, no artifact, no GitHub call (AC-51)', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], key: '' });
    expect(r.code).toBe(2);
    expect(r.logs.join('\n')).toContain('OPENROUTER_API_KEY');
    expect(r.artifact).toBeNull();
    expect(r.api.requests).toHaveLength(0);
  });

  it('never leaks env values into the log', async () => {
    const r = await run({ findings: [CRITICAL_FINDING], reviewStatuses: [500] });
    const all = r.logs.join('\n');
    expect(all).not.toContain('ghs_testtoken');
    expect(all).not.toContain('sk-or-v1-test-key-0000');
  });

  it('passes skills, memory and the PR description to the engine (AC-46)', async () => {
    const work = await makeWorkDir();
    const api = fakeGitHub(await diffRaw());
    const llm = new MockLLMProvider('openai', { structured: reviewFixture([]) });
    await main({ env: work.env, cwd: work.cwd, fetchImpl: api.fetchImpl, llm, log: () => {} });
    const sent = JSON.stringify(llm.calls);
    expect(sent).toContain('Check for injection.');
    expect(sent).toContain('We use Postgres.');
    expect(sent).toContain('Adds config');
    await expect(stat(path.join(work.cwd, 'devdigest-result.json'))).resolves.toBeTruthy();
  });
});
