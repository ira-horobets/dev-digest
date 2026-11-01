/** MultiAgentService with in-memory fakes (no DB). */
import { describe, expect, it } from 'vitest';
import { MultiAgentService } from '../src/modules/multi-agent/service.js';
import { FakeMultiAgentRepo, FakeRunner, PR_ID, WS, agentId } from './helpers/multi-agent.js';

const make = () => {
  const repo = new FakeMultiAgentRepo();
  const runner = new FakeRunner();
  const service = new MultiAgentService({ repo, runner, concurrency: 3, lineTolerance: 3 });
  return { repo, runner, service };
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => agentId(i + 1));

describe('MultiAgentService.start', () => {
  it('400 for <2, >8 and duplicates; nothing is created', async () => {
    const { repo, runner, service } = make();
    for (const list of [ids(1), Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-00000000020${i}`), [agentId(1), agentId(1)]]) {
      await expect(service.start(WS, PR_ID, list)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(repo.created).toHaveLength(0);
    expect(runner.calls).toHaveLength(0);
  });

  it('404 for an unknown PR, an unknown agent and a non-UUID id; nothing is created', async () => {
    const { repo, service } = make();
    await expect(service.start(WS, '00000000-0000-4000-8000-0000000000bb', ids(2))).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.start(WS, PR_ID, [agentId(1), '00000000-0000-4000-8000-000000000999'])).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.start(WS, PR_ID, [agentId(1), 'nope'])).rejects.toMatchObject({ statusCode: 404 });
    expect(repo.created).toHaveLength(0);
  });

  it('creates the rows, returns before the runner finishes and calls it once with the cap', async () => {
    const { runner, service } = make();
    const out = await service.start(WS, PR_ID, ids(3));
    expect(out).toMatchObject({ multi_run_id: 'multi-1', pr_id: PR_ID });
    expect(out.runs.map((r) => r.agent_id)).toEqual(ids(3));
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toMatchObject({ prId: PR_ID, concurrency: 3 });
    expect(runner.calls[0]!.queued).toHaveLength(3);
  });

  it('a crashing runner is logged, not thrown', async () => {
    const { runner, service } = make();
    runner.fail = true;
    const errors: unknown[] = [];
    const logger = { info() {}, warn() {}, debug() {}, error: (o: unknown) => errors.push(o) };
    await service.start(WS, PR_ID, ids(2), logger);
    await new Promise((r) => setTimeout(r, 5));
    expect(errors).toHaveLength(1);
  });
});

describe('MultiAgentService reads', () => {
  it('404 when there is no run; estimates carry the cap and nulls for agents without history', async () => {
    const { repo, service } = make();
    await expect(service.get(WS, 'x')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.latest(WS, PR_ID)).rejects.toMatchObject({ statusCode: 404 });
    repo.rows = [{ agentId: agentId(1), durationMs: 2000, costUsd: 0.5 }];
    const est = await service.estimates(WS);
    expect(est.concurrency).toBe(3);
    expect(est.agents.find((a) => a.agent_id === agentId(1))).toMatchObject({ duration_ms: 2000, samples: 1 });
    expect(est.agents.find((a) => a.agent_id === agentId(2))).toMatchObject({ duration_ms: null, cost_usd: null, samples: 0 });
  });
});
