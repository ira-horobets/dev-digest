import type {
  AgentInfo,
  ChildFinding,
  ChildRun,
  CreatedMultiRun,
  EstimateRow,
  Logger,
  MultiAgentRepositoryPort,
  MultiRunData,
  PullInfo,
  ReviewRunnerPort,
} from '../../src/modules/multi-agent/ports.js';

export const WS = '00000000-0000-4000-8000-000000000001';
export const PR_ID = '00000000-0000-4000-8000-0000000000aa';
export const agentId = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;

export const finding = (id: string, file: string, start: number, end: number, severity = 'WARNING', title = `t-${id}`): ChildFinding => ({
  id,
  severity,
  category: 'bug',
  title,
  file,
  startLine: start,
  endLine: end,
  kind: 'finding',
});

export const child = (n: number, over: Partial<ChildRun> = {}): ChildRun => ({
  runId: `run-${n}`,
  agentId: agentId(n),
  agentName: `Agent ${n}`,
  provider: 'openrouter',
  model: 'm',
  status: 'done',
  error: null,
  durationMs: 1000 * n,
  costUsd: 0.01 * n,
  review: { verdict: 'comment', score: 80, summary: 's' },
  findings: [],
  ...over,
});

export class FakeMultiAgentRepo implements MultiAgentRepositoryPort {
  agents: AgentInfo[] = [1, 2, 3, 4].map((n) => ({ id: agentId(n), name: `Agent ${n}` }));
  created: { prId: string; agents: AgentInfo[] }[] = [];
  data: MultiRunData | undefined;
  rows: EstimateRow[] = [];

  async getPull(_ws: string, prId: string): Promise<PullInfo | undefined> {
    return prId === PR_ID ? { id: PR_ID, number: 7 } : undefined;
  }
  async findAgents(_ws: string, ids: string[]) {
    return this.agents.filter((a) => ids.includes(a.id));
  }
  async createMultiRun(_ws: string, prId: string, agents: AgentInfo[]): Promise<CreatedMultiRun> {
    this.created.push({ prId, agents });
    return {
      multiRunId: 'multi-1',
      runs: agents.map((a, i) => ({ run_id: `run-${i}`, agent_id: a.id, agent_name: a.name })),
    };
  }
  async getMultiRun() {
    return this.data;
  }
  async latestForPull() {
    return this.data;
  }
  async listAgentIds() {
    return this.agents.map((a) => a.id);
  }
  async estimateRows() {
    return this.rows;
  }
}

export class FakeRunner implements ReviewRunnerPort {
  calls: { prId: string; queued: { agentId: string; runId: string }[]; concurrency: number }[] = [];
  fail = false;
  async executeQueued(_ws: string, prId: string, queued: { agentId: string; runId: string }[], opts: { concurrency: number; logger?: Logger }) {
    this.calls.push({ prId, queued, concurrency: opts.concurrency });
    if (this.fail) throw new Error('boom');
  }
}
