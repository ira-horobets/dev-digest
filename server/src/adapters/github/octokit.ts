import { Octokit } from 'octokit';
import { z } from 'zod';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  GitHubApiError,
  WorkflowRunInfo,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

const TIMEOUT = 30_000;
/** Largest file `getFileContent` will decode (bytes). */
const MAX_FILE_BYTES = 200 * 1024;

const ClosingIssuesResponse = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          closingIssuesReferences: z.object({
            nodes: z.array(z.object({ number: z.number().int() }).nullable()),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

const FileContentResponse = z.object({
  type: z.literal('file'),
  size: z.number().int(),
  encoding: z.string(),
  content: z.string(),
});

/** Error thrown by the CI-related GitHub calls. Never carries the token or request headers. */
export class GitHubRequestError extends Error implements GitHubApiError {
  status: number;
  tokenKind: GitHubApiError['tokenKind'];
  acceptedPermissions?: string[][];
  oauthScopes?: string[];
  acceptedOauthScopes?: string[];
  retryAfterMs?: number;
  constructor(info: GitHubApiError) {
    super(info.message);
    this.name = 'GitHubRequestError';
    this.status = info.status;
    this.tokenKind = info.tokenKind;
    this.acceptedPermissions = info.acceptedPermissions;
    this.oauthScopes = info.oauthScopes;
    this.acceptedOauthScopes = info.acceptedOauthScopes;
    this.retryAfterMs = info.retryAfterMs;
  }
}

const splitList = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Strip markup and cap length: GitHub messages are shown to the user as text. */
function plainText(v: unknown): string {
  const t = typeof v === 'string' ? v : 'GitHub request failed';
  return t.replace(/<[^>]*>/g, '').slice(0, 500);
}

/**
 * Map an Octokit `RequestError` (or any error) to `GitHubRequestError`.
 * Fine-grained PATs / Apps get `x-accepted-github-permissions`; classic PATs get
 * the `x-oauth-scopes` pair. Rate limits come from `retry-after` or
 * `x-ratelimit-remaining: 0` + `x-ratelimit-reset`.
 */
export function toGitHubRequestError(err: unknown, now: number = Date.now()): unknown {
  if (err instanceof GitHubRequestError) return err;
  const e = err as {
    status?: number;
    message?: string;
    response?: { headers?: Record<string, string | undefined>; data?: { message?: unknown } };
  };
  if (typeof e?.status !== 'number') return err;
  const h = e.response?.headers ?? {};
  const accepted = h['x-accepted-github-permissions'];
  const info: GitHubApiError = {
    status: e.status,
    message: plainText(e.response?.data?.message ?? e.message),
    tokenKind: 'unknown',
  };
  if (accepted) {
    info.tokenKind = 'fine_grained';
    info.acceptedPermissions = accepted
      .split(';')
      .map((alt) => alt.split(',').map((x) => x.trim()).filter(Boolean))
      .filter((alt) => alt.length > 0);
  } else if (h['x-oauth-scopes'] !== undefined || h['x-accepted-oauth-scopes'] !== undefined) {
    info.tokenKind = 'classic';
    info.oauthScopes = splitList(h['x-oauth-scopes']);
    info.acceptedOauthScopes = splitList(h['x-accepted-oauth-scopes']);
  }
  if (e.status === 429 || e.status === 403) {
    const ra = h['retry-after'];
    if (ra && /^\d+$/.test(ra.trim())) info.retryAfterMs = Number(ra.trim()) * 1000;
    else if (h['x-ratelimit-remaining'] === '0' && h['x-ratelimit-reset']) {
      const at = Number(h['x-ratelimit-reset']) * 1000;
      if (Number.isFinite(at)) info.retryAfterMs = Math.max(0, at - now);
    }
  }
  return new GitHubRequestError(info);
}

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;
  private fetchImpl: typeof fetch;

  constructor(token: string, opts: { octokit?: Octokit; fetchImpl?: typeof fetch } = {}) {
    this.octokit = opts.octokit ?? new Octokit({ auth: token });
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Run a GitHub call with timeout + retry, mapping failures to `GitHubRequestError`. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await withRetry(() => withTimeout(fn(), TIMEOUT));
    } catch (err) {
      throw toGitHubRequestError(err);
    }
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(
    repo: RepoRef,
    payload: OpenPrPayload,
  ): Promise<{ url: string; number: number }> {
    return this.call(
        async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url, number: res.data.number };
        },
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return this.call(
        async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        },
    );
  }

  async findOpenPr(
    repo: RepoRef,
    branch: string,
  ): Promise<{ url: string; number: number } | null> {
    return this.call(
        async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url, number: pr.number } : null;
        },
    );
  }

  async getRepoInfo(repo: RepoRef): Promise<{ default_branch: string; private?: boolean }> {
    return this.call(async () => {
      const res = await this.octokit.rest.repos.get({ owner: repo.owner, repo: repo.name });
      return {
        default_branch: z.string().min(1).parse(res.data.default_branch),
        private: typeof res.data.private === 'boolean' ? res.data.private : undefined,
      };
    });
  }

  async getOptionalFileContent(repo: RepoRef, path: string, ref: string): Promise<string | null> {
    try {
      const res = await this.call(() =>
        this.octokit.rest.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref }),
      );
      const file = FileContentResponse.parse(res.data);
      if (file.size > MAX_FILE_BYTES) throw new Error('file too large');
      if (file.encoding !== 'base64') throw new Error('unsupported file encoding');
      return Buffer.from(file.content, 'base64').toString('utf8');
    } catch (err) {
      if ((err as { status?: number })?.status === 404) return null;
      throw err;
    }
  }

  async listActionsSecretNames(repo: RepoRef): Promise<{
    repo: string[];
    org: string[] | null;
    org_unreadable?: boolean;
    has_environments: boolean;
  }> {
    const names = (data: unknown): string[] =>
      z
        .object({ secrets: z.array(z.object({ name: z.string() })) })
        .parse(data)
        .secrets.map((x) => x.name);
    const repoSecrets = await this.call(() =>
      this.octokit.rest.actions.listRepoSecrets({ owner: repo.owner, repo: repo.name, per_page: 100 }),
    );
    let org: string[] | null = null;
    let orgUnreadable = false;
    try {
      const res = await this.call(() =>
        this.octokit.request('GET /repos/{owner}/{repo}/actions/organization-secrets', {
          owner: repo.owner,
          repo: repo.name,
          per_page: 100,
        }),
      );
      org = names(res.data);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 403 && status !== 404) throw err;
      orgUnreadable = status === 403;
    }
    let hasEnvironments: boolean;
    try {
      const envs = await this.call(() =>
        this.octokit.rest.repos.getAllEnvironments({ owner: repo.owner, repo: repo.name, per_page: 1 }),
      );
      hasEnvironments = (envs.data.total_count ?? 0) > 0;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 403 && status !== 404) throw err;
      // Unreadable environments: be conservative, they might hold the secret.
      hasEnvironments = status === 403;
    }
    return {
      repo: names(repoSecrets.data),
      org,
      org_unreadable: orgUnreadable,
      has_environments: hasEnvironments,
    };
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    perPage: number,
  ): Promise<WorkflowRunInfo[]> {
    const res = await this.call(() =>
      this.octokit.rest.actions.listWorkflowRuns({
        owner: repo.owner,
        repo: repo.name,
        workflow_id: workflowFile,
        per_page: perPage,
        event: 'pull_request',
      }),
    );
    return res.data.workflow_runs.map((r) => ({
      id: r.id,
      run_attempt: r.run_attempt ?? 1,
      status: r.status ?? null,
      conclusion: r.conclusion ?? null,
      html_url: r.html_url,
      pr_numbers: (r.pull_requests ?? []).map((p) => p.number),
      created_at: r.created_at,
      run_started_at: r.run_started_at ?? null,
      updated_at: r.updated_at,
    }));
  }

  async downloadArtifact(
    repo: RepoRef,
    runId: number,
    name: string,
    maxBytes: number,
  ): Promise<Uint8Array | null | 'too_large'> {
    const list = await this.call(() =>
      this.octokit.rest.actions.listWorkflowRunArtifacts({
        owner: repo.owner,
        repo: repo.name,
        run_id: runId,
        per_page: 100,
      }),
    );
    const art = list.data.artifacts.find((a) => a.name === name && !a.expired);
    if (!art) return null;
    // Size is known from the list: refuse before downloading anything.
    if (art.size_in_bytes > maxBytes) return 'too_large';
    const res = await this.call(() =>
      this.octokit.request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}', {
        owner: repo.owner,
        repo: repo.name,
        artifact_id: art.id,
        archive_format: 'zip',
        request: { redirect: 'manual' },
      }),
    );
    const location = (res.headers as Record<string, string | undefined>).location;
    if (!location) return null;
    const url = new URL(location);
    if (url.protocol !== 'https:') return null;
    // The redirect target is on another origin and expires in a minute: follow
    // it at once, with NO Authorization header, and cap the bytes read.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const dl = await this.fetchImpl(url.toString(), {
        headers: { Accept: 'application/zip' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!dl.ok || !dl.body) return null;
      const reader = dl.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          return 'too_large';
        }
        chunks.push(value);
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  async getPullState(repo: RepoRef, n: number): Promise<'open' | 'merged' | 'closed'> {
    const res = await this.call(() =>
      this.octokit.rest.pulls.get({ owner: repo.owner, repo: repo.name, pull_number: n }),
    );
    return mapStatus(res.data.state, Boolean(res.data.merged_at)) as 'open' | 'merged' | 'closed';
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async getClosingIssues(repo: RepoRef, n: number): Promise<number[]> {
    const raw = await withRetry(() =>
      withTimeout(
        this.octokit.graphql(
          `query($owner: String!, $name: String!, $n: Int!) {
            repository(owner: $owner, name: $name) {
              pullRequest(number: $n) {
                closingIssuesReferences(first: 5) { nodes { number } }
              }
            }
          }`,
          { owner: repo.owner, name: repo.name, n },
        ),
        TIMEOUT,
      ),
    );
    const parsed = ClosingIssuesResponse.parse(raw);
    const nodes = parsed.repository?.pullRequest?.closingIssuesReferences.nodes ?? [];
    return nodes.flatMap((node) => (node ? [node.number] : []));
  }

  async getFileContent(repo: RepoRef, path: string, ref: string): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref }),
        TIMEOUT,
      ),
    );
    // A directory comes back as an array; symlinks/submodules have another `type`.
    const file = FileContentResponse.parse(res.data);
    if (file.size > MAX_FILE_BYTES) throw new Error('file too large');
    if (file.encoding !== 'base64') throw new Error('unsupported file encoding');
    return Buffer.from(file.content, 'base64').toString('utf8');
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }
}
