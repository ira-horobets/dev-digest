/** Minimal fetch-based GitHub client for the runner. Bearer GITHUB_TOKEN. */
export class GitHubHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubHttpError';
  }
}

export interface PullInfo {
  title: string;
  body: string;
  headSha: string;
}

export type ReviewEventKind = 'REQUEST_CHANGES' | 'COMMENT';

export class GitHubApi {
  constructor(
    private readonly opts: {
      token: string;
      apiUrl: string;
      repository: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private async request(
    method: string,
    path: string,
    init: { accept?: string; body?: unknown } = {},
  ): Promise<Response> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`${this.opts.apiUrl}/repos/${this.opts.repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: init.accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      let message = `GitHub answered ${res.status}`;
      try {
        const data = (await res.json()) as { message?: unknown };
        if (typeof data.message === 'string') message = data.message.slice(0, 300);
      } catch {
        // non-JSON body
      }
      throw new GitHubHttpError(res.status, message);
    }
    return res;
  }

  async getPull(n: number): Promise<PullInfo> {
    const data = (await (await this.request('GET', `/pulls/${n}`)).json()) as {
      title?: string;
      body?: string | null;
      head?: { sha?: string };
    };
    return { title: data.title ?? '', body: data.body ?? '', headSha: data.head?.sha ?? '' };
  }

  async getDiff(n: number): Promise<string> {
    return (await this.request('GET', `/pulls/${n}`, { accept: 'application/vnd.github.v3.diff' })).text();
  }

  /** Never `APPROVE`: GITHUB_TOKEN may not approve, and the runner never should. */
  async postReview(
    n: number,
    body: string,
    event: ReviewEventKind,
    comments?: { path: string; line: number; body: string }[],
  ): Promise<void> {
    if ((event as string) === 'APPROVE') throw new Error('The runner never sends an APPROVE review');
    await this.request('POST', `/pulls/${n}/reviews`, {
      body: { body, event, ...(comments?.length ? { comments } : {}) },
    });
  }

  async postComment(n: number, body: string): Promise<void> {
    await this.request('POST', `/issues/${n}/comments`, { body: { body } });
  }
}
