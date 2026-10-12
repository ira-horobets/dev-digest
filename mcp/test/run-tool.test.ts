import { describe, it, expect } from 'vitest';
import { connect, textOf } from './connect.js';
import { AGENT_ID, CONFIG, PR_ID, REPO, RUN_ID, finding, runFindings, runSummary, type Handler } from './helpers.js';

function api(statusSeq: string[], opts: { post?: Handler } = {}): Handler {
  const seq = [...statusSeq];
  return (m, p, body) => {
    if (p === '/repos') return { body: [REPO] };
    if (p === `/repos/${REPO.id}/pulls`) return { body: [{ id: PR_ID, number: 482, title: 'Add rate limiting' }] };
    if (m === 'POST' && p === `/pulls/${PR_ID}/review`) {
      return opts.post?.(m, p, body) ?? { body: { pr_id: PR_ID, runs: [{ run_id: RUN_ID, agent_id: AGENT_ID, agent_name: 'Security' }], reviews: [] } };
    }
    if (p === `/runs/${RUN_ID}/findings`) {
      const s = seq.length > 1 ? seq.shift()! : seq[0]!;
      return { body: runFindings(s, s === 'done' ? [finding('a', 'CRITICAL')] : [], s === 'failed' ? { error: 'LLM exploded' } : {}) };
    }
    if (p === `/pulls/${PR_ID}/runs`) return { body: [runSummary('running', { run_id: 'r-run' }), runSummary('done')] };
    return undefined;
  };
}

const args = { repo: 'acme/payments-api', pr_number: 482, agent_id: AGENT_ID };

describe('devdigest_run_agent_on_pr', () => {
  it('resolves, posts, polls with progress and returns the verdict', async () => {
    const { client, calls } = await connect(api(['running', 'running', 'done']));
    const progress: unknown[] = [];
    const res = await client.callTool(
      { name: 'devdigest_run_agent_on_pr', arguments: args },
      undefined,
      { onprogress: (p) => progress.push(p) },
    );
    expect(res.isError).toBeFalsy();
    const out = JSON.parse(textOf(res));
    expect(out.verdict).toBe('request_changes');
    expect(out.findings).toHaveLength(1);
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ agentId: AGENT_ID });
    expect(progress.length).toBe(2);
    expect(JSON.stringify(progress[0])).toContain('Security on acme/payments-api#482');
  });

  it('falls back to run_id + running at the max wait (non-error)', async () => {
    const { client } = await connect(api(['running']), { ...CONFIG, maxWaitMs: 5000 });
    const res = await client.callTool({ name: 'devdigest_run_agent_on_pr', arguments: args });
    expect(res.isError).toBeFalsy();
    const out = JSON.parse(textOf(res));
    expect(out).toMatchObject({ run_id: RUN_ID, status: 'running' });
    expect(out.next).toContain('devdigest_get_findings');
  });

  it('returns isError for a failed run with the run error and run_id', async () => {
    const { client } = await connect(api(['running', 'failed']));
    const res = await client.callTool({ name: 'devdigest_run_agent_on_pr', arguments: args });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('LLM exploded');
    expect(textOf(res)).toContain(RUN_ID);
  });

  it('surfaces an unknown repo as isError with candidates', async () => {
    const { client } = await connect(api(['done']));
    const res = await client.callTool({ name: 'devdigest_run_agent_on_pr', arguments: { ...args, repo: 'nope' } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('acme/payments-api');
  });

  it('maps a 429 on the trigger to an actionable error', async () => {
    const { client } = await connect(api(['done'], { post: () => ({ status: 429, headers: { 'retry-after': '30' }, body: { error: { code: 'rate_limited', message: 'x' } } }) }));
    const res = await client.callTool({ name: 'devdigest_run_agent_on_pr', arguments: args });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('retry in 30s');
  });
});

describe('other tools through the server', () => {
  it('get_findings by run_id, by repo+pr (latest finished) and with no target', async () => {
    const { client } = await connect(api(['done']));
    const byRun = await client.callTool({ name: 'devdigest_get_findings', arguments: { run_id: RUN_ID } });
    expect(JSON.parse(textOf(byRun)).run_id).toBe(RUN_ID);
    const byPr = await client.callTool({ name: 'devdigest_get_findings', arguments: { repo: 'payments-api', pr_number: 482 } });
    expect(byPr.isError).toBeFalsy();
    expect(JSON.parse(textOf(byPr)).findings).toHaveLength(1);
    const none = await client.callTool({ name: 'devdigest_get_findings', arguments: {} });
    expect(none.isError).toBe(true);
    expect(textOf(none)).toContain('pr_number');
  });

  it('get_findings reports a running run as a normal result', async () => {
    const { client } = await connect(api(['running']));
    const res = await client.callTool({ name: 'devdigest_get_findings', arguments: { run_id: RUN_ID } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res)).status).toBe('running');
  });

  it('list_agents drops prompts; unreachable API names dev.sh', async () => {
    const h: Handler = (_m, p) => (p === '/agents' ? { body: [{ id: 'a', name: 'A', description: '', provider: 'openai', model: 'm', system_prompt: 'TOPSECRET', enabled: true, strategy: 'single-pass', skill_count: 0, stats: { runs: 1 } }] } : undefined);
    const { client } = await connect(h);
    const res = await client.callTool({ name: 'devdigest_list_agents', arguments: {} });
    expect(textOf(res)).not.toContain('TOPSECRET');

    const down = await connect(() => { throw new TypeError('fetch failed'); });
    const r2 = await down.client.callTool({ name: 'devdigest_list_agents', arguments: {} });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).toContain('./scripts/dev.sh');
  });

  it('rejects invalid input at the protocol layer (bad uuid)', async () => {
    const { client } = await connect(api(['done']));
    const res = await client.callTool({ name: 'devdigest_get_findings', arguments: { run_id: 'abc' } }).catch((e) => e);
    const isErr = res instanceof Error || (res as { isError?: boolean }).isError === true;
    expect(isErr).toBe(true);
  });

  it('get_findings by repo+pr skips a newer running run and uses the latest finished one', async () => {
    const { client } = await connect(api(['done']));
    const res = await client.callTool({ name: 'devdigest_get_findings', arguments: { repo: 'acme/payments-api', pr_number: 482 } });
    expect(res.isError).toBeFalsy();
    const out = JSON.parse(textOf(res));
    expect(out.run_id).toBe(RUN_ID);
    expect(out.findings).toHaveLength(1);
  });

  it('get_findings by repo+pr with only a running run is a non-error running result', async () => {
    const base = api(['running']);
    const { client } = await connect((m, p, b) =>
      p === `/pulls/${PR_ID}/runs` ? { body: [runSummary('running', { run_id: 'only-running' })] } : base(m, p, b),
    );
    const res = await client.callTool({ name: 'devdigest_get_findings', arguments: { repo: 'acme/payments-api', pr_number: 482 } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res))).toMatchObject({ run_id: 'only-running', status: 'running' });
  });

  it('get_findings with an agent_id that matches nothing is an error pointing at the run tool', async () => {
    const { client } = await connect(api(['done']));
    const res = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: 'acme/payments-api', pr_number: 482, agent_id: '44444444-4444-4444-8444-444444444444' },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('devdigest_run_agent_on_pr');
  });
});
