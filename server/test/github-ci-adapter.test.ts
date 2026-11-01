/**
 * OctokitGitHubClient CI methods against a stubbed Octokit and a stubbed fetch:
 * error header mapping for both token kinds, artifact size refusal before
 * download, the redirect followed without Authorization, and the byte cap.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from 'octokit';
import { OctokitGitHubClient, toGitHubRequestError, GitHubRequestError } from '../src/adapters/github/octokit.js';

const repo = { owner: 'acme', name: 'api' };

describe('toGitHubRequestError', () => {
  it('fine-grained: parses x-accepted-github-permissions alternatives', () => {
    const e = toGitHubRequestError({
      status: 403,
      message: 'Resource not accessible by personal access token',
      response: {
        headers: { 'x-accepted-github-permissions': 'contents=write, workflows=write; administration=write' },
        data: { message: 'Resource not accessible by personal access token' },
      },
    }) as GitHubRequestError;
    expect(e).toBeInstanceOf(GitHubRequestError);
    expect(e).toMatchObject({ status: 403, tokenKind: 'fine_grained' });
    expect(e.acceptedPermissions).toEqual([['contents=write', 'workflows=write'], ['administration=write']]);
  });

  it('classic: parses the oauth scope headers', () => {
    const e = toGitHubRequestError({
      status: 404,
      response: { headers: { 'x-oauth-scopes': 'repo, gist', 'x-accepted-oauth-scopes': 'repo, workflow' }, data: { message: 'Not Found' } },
    }) as GitHubRequestError;
    expect(e).toMatchObject({ tokenKind: 'classic', oauthScopes: ['repo', 'gist'], acceptedOauthScopes: ['repo', 'workflow'] });
  });

  it('unknown kind without headers; markup is stripped and the length capped', () => {
    const e = toGitHubRequestError({ status: 422, response: { headers: {}, data: { message: '<b>bad</b> ' + 'x'.repeat(900) } } }) as GitHubRequestError;
    expect(e.tokenKind).toBe('unknown');
    expect(e.message.startsWith('bad ')).toBe(true);
    expect(e.message.length).toBeLessThanOrEqual(500);
  });

  it('rate limit from retry-after or remaining=0 + reset; never in an error text', () => {
    expect(toGitHubRequestError({ status: 429, response: { headers: { 'retry-after': '12' }, data: {} } }, 0)).toMatchObject({ retryAfterMs: 12000 });
    const e = toGitHubRequestError(
      { status: 403, response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '100' }, data: {} } },
      40_000,
    ) as GitHubRequestError;
    expect(e.retryAfterMs).toBe(60_000);
    const withAuth = toGitHubRequestError({ status: 401, message: 'Bad', response: { headers: { authorization: 'token ghp_secret' }, data: {} } });
    expect(JSON.stringify(withAuth)).not.toContain('ghp_secret');
  });

  it('passes non-HTTP errors through', () => {
    const err = new Error('boom');
    expect(toGitHubRequestError(err)).toBe(err);
  });
});

const octokitFor = (artifacts: object[], redirect: string | null) => {
  const request = vi.fn(async () => ({ headers: redirect ? { location: redirect } : {}, data: '' }));
  const listWorkflowRunArtifacts = vi.fn(async () => ({ data: { artifacts } }));
  return {
    octokit: { request, rest: { actions: { listWorkflowRunArtifacts } } } as unknown as Octokit,
    request,
    listWorkflowRunArtifacts,
  };
};

const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });

describe('downloadArtifact (row 4)', () => {
  const art = { id: 5, name: 'devdigest-result', size_in_bytes: 10, expired: false };

  it('returns null when the artifact is absent or expired', async () => {
    const o = octokitFor([{ ...art, name: 'other' }, { ...art, expired: true }], null);
    const c = new OctokitGitHubClient('t', { octokit: o.octokit, fetchImpl: vi.fn() as never });
    expect(await c.downloadArtifact(repo, 1, 'devdigest-result', 100)).toBeNull();
    expect(o.request).not.toHaveBeenCalled();
  });

  it('refuses by listed size before any download', async () => {
    const o = octokitFor([{ ...art, size_in_bytes: 5000 }], 'https://blob.example/x');
    const fetchImpl = vi.fn();
    const c = new OctokitGitHubClient('t', { octokit: o.octokit, fetchImpl: fetchImpl as never });
    expect(await c.downloadArtifact(repo, 1, 'devdigest-result', 1000)).toBe('too_large');
    expect(o.request).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('follows the redirect with no Authorization header and returns the bytes', async () => {
    const o = octokitFor([art], 'https://blob.example/x?sig=1');
    const fetchImpl = vi.fn(async () => new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])])));
    const c = new OctokitGitHubClient('ghp_secret', { octokit: o.octokit, fetchImpl: fetchImpl as never });
    const bytes = await c.downloadArtifact(repo, 1, 'devdigest-result', 1000);
    expect(Array.from(bytes as Uint8Array)).toEqual([1, 2, 3]);
    // The GitHub call asked for the redirect not to be followed.
    expect(o.request.mock.calls[0]![1]).toMatchObject({ request: { redirect: 'manual' }, archive_format: 'zip' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://blob.example/x?sig=1');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(JSON.stringify(init)).not.toContain('ghp_secret');
  });

  it('aborts at the byte cap while streaming', async () => {
    const o = octokitFor([art], 'https://blob.example/x');
    const fetchImpl = vi.fn(async () => new Response(streamOf([new Uint8Array(600), new Uint8Array(600)])));
    const c = new OctokitGitHubClient('t', { octokit: o.octokit, fetchImpl: fetchImpl as never });
    expect(await c.downloadArtifact(repo, 1, 'devdigest-result', 1000)).toBe('too_large');
  });

  it('refuses a non-https redirect target', async () => {
    const o = octokitFor([art], 'http://blob.example/x');
    const fetchImpl = vi.fn();
    const c = new OctokitGitHubClient('t', { octokit: o.octokit, fetchImpl: fetchImpl as never });
    expect(await c.downloadArtifact(repo, 1, 'devdigest-result', 1000)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
