import { describe, expect, it } from 'vitest';
import { GitHubApi, GitHubHttpError } from '../src/github.js';
import { fakeGitHub } from './helpers/fixture.js';

const client = (fetchImpl: typeof fetch) =>
  new GitHubApi({ token: 't0k', apiUrl: 'https://api.github.test', repository: 'acme/api', fetchImpl });

describe('GitHubApi', () => {
  it('reads the PR with the JSON media type and the diff with the diff media type', async () => {
    const fake = fakeGitHub('DIFF');
    const a = client(fake.fetchImpl);
    expect((await a.getPull(7)).title).toBe('Add config');
    expect(await a.getDiff(7)).toBe('DIFF');
    expect(fake.requests[0]!.accept).toBe('application/vnd.github+json');
    expect(fake.requests[1]!.accept).toBe('application/vnd.github.v3.diff');
    expect(fake.requests.every((r) => r.authorization === 'Bearer t0k')).toBe(true);
  });

  it('posts a review and a comment with the documented shapes', async () => {
    const fake = fakeGitHub('');
    const a = client(fake.fetchImpl);
    await a.postReview(7, 'body', 'COMMENT', [{ path: 'a.ts', line: 3, body: 'x' }]);
    await a.postComment(7, 'hello');
    const [review, comment] = fake.writes();
    expect(review!.url).toBe('https://api.github.test/repos/acme/api/pulls/7/reviews');
    expect(review!.body).toEqual({ body: 'body', event: 'COMMENT', comments: [{ path: 'a.ts', line: 3, body: 'x' }] });
    expect(comment!.url).toBe('https://api.github.test/repos/acme/api/issues/7/comments');
    expect(comment!.body).toEqual({ body: 'hello' });
  });

  it('never sends APPROVE', async () => {
    const fake = fakeGitHub('');
    await expect(client(fake.fetchImpl).postReview(7, 'b', 'APPROVE' as never)).rejects.toThrow(/never sends/);
    expect(fake.requests).toHaveLength(0);
  });

  it('throws typed errors carrying only status and the GitHub message', async () => {
    const fake = fakeGitHub('', { reviewStatuses: [403, 422] });
    const a = client(fake.fetchImpl);
    const e403 = await a.postReview(7, 'b', 'COMMENT').catch((e) => e);
    expect(e403).toBeInstanceOf(GitHubHttpError);
    expect(e403.status).toBe(403);
    expect(e403.message).toBe('rejected 403');
    const e422 = await a.postReview(7, 'b', 'COMMENT').catch((e) => e);
    expect(e422.status).toBe(422);
    expect(JSON.stringify(e403)).not.toContain('t0k');
  });
});
