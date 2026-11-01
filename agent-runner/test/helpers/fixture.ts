import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockGitClient } from '../../../server/src/adapters/mocks.js';

export const CRITICAL_FINDING = {
  id: 'f1',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded Stripe secret key',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'sk_live in diff',
  confidence: 0.98,
  kind: 'finding',
};

export const WARNING_FINDING = { ...CRITICAL_FINDING, id: 'f2', severity: 'WARNING', title: 'Weak check' };

export const reviewFixture = (findings: unknown[]) => ({
  verdict: findings.length ? 'request_changes' : 'approve',
  summary: 'summary',
  score: 50,
  findings,
});

export async function diffRaw(): Promise<string> {
  return (await new MockGitClient().diff()).raw;
}

export interface WorkDirOptions {
  ciFailOn?: string;
  skills?: Record<string, string>;
  memory?: string;
  slug?: string;
}

/** A target-repo checkout with the exported `.devdigest/` files and an event payload. */
export async function makeWorkDir(opts: WorkDirOptions = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'devdigest-runner-'));
  const slug = opts.slug ?? 'test-agent';
  const skills = opts.skills ?? { 'owasp-rules': 'Check for injection.\n' };
  await mkdir(path.join(cwd, '.devdigest', 'agents'), { recursive: true });
  await mkdir(path.join(cwd, '.devdigest', 'skills'), { recursive: true });
  await writeFile(
    path.join(cwd, '.devdigest', 'agents', `${slug}.yaml`),
    [
      'name: Test agent',
      'provider: openrouter',
      'model: deepseek/deepseek-v4-flash',
      'system_prompt: |',
      '  You are a strict reviewer.',
      `skills: [${Object.keys(skills).join(', ')}]`,
      'strategy: single-pass',
      `ci_fail_on: ${opts.ciFailOn ?? 'critical'}`,
      '',
    ].join('\n'),
  );
  for (const [s, body] of Object.entries(skills)) {
    await writeFile(path.join(cwd, '.devdigest', 'skills', `${s}.md`), body);
  }
  await writeFile(
    path.join(cwd, '.devdigest', 'memory.jsonl'),
    opts.memory ?? '{"id":"m1","scope":"global","kind":"fact","content":"We use Postgres."}\nnot json\n',
  );
  const eventPath = path.join(cwd, 'event.json');
  await writeFile(eventPath, JSON.stringify({ pull_request: { number: 7 } }));
  return {
    cwd,
    slug,
    env: {
      OPENROUTER_API_KEY: 'sk-or-v1-test-key-0000',
      GITHUB_TOKEN: 'ghs_testtoken',
      GITHUB_REPOSITORY: 'acme/api',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: 'https://api.github.test',
      DEVDIGEST_AGENT: `.devdigest/agents/${slug}.yaml`,
      DEVDIGEST_POST_AS: 'github_review',
    } as Record<string, string>,
  };
}

export interface RecordedRequest {
  method: string;
  url: string;
  accept: string | null;
  authorization: string | null;
  body: any;
}

/** Fake GitHub API: serves the PR + diff, records writes; `reviewStatuses` are the answers to successive review posts. */
export function fakeGitHub(diff: string, opts: { reviewStatuses?: number[]; commentStatus?: number } = {}) {
  const requests: RecordedRequest[] = [];
  const statuses = [...(opts.reviewStatuses ?? [])];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({
      method: init?.method ?? 'GET',
      url,
      accept: headers.get('accept'),
      authorization: headers.get('authorization'),
      body,
    });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/pulls/7') && (init?.method ?? 'GET') === 'GET') {
      if (headers.get('accept')?.includes('diff')) return new Response(diff, { status: 200 });
      return json(200, { title: 'Add config', body: 'Adds config', head: { sha: 'abc' } });
    }
    if (url.endsWith('/pulls/7/reviews')) {
      const status = statuses.shift() ?? 200;
      return status === 200 ? json(200, { id: 1 }) : json(status, { message: `rejected ${status}` });
    }
    if (url.endsWith('/issues/7/comments')) {
      const status = opts.commentStatus ?? 201;
      return status < 300 ? json(status, { id: 2 }) : json(status, { message: 'no' });
    }
    return json(404, { message: 'not found' });
  }) as typeof fetch;
  return {
    fetchImpl,
    requests,
    writes: () => requests.filter((r) => r.method === 'POST'),
  };
}
