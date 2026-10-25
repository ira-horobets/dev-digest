import { describe, it, expect, vi } from 'vitest';
import type { LLMProvider } from '@devdigest/shared';
import { EvalService } from '../src/modules/eval/service.js';
import type {
  CompleteEvalRun,
  EvalCaseRow,
  EvalRepository,
  EvalRunRow,
  FindingForCase,
  InsertEvalCase,
  InsertEvalRun,
} from '../src/modules/eval/repository.js';
import type { AgentLookup, AgentRecord } from '../src/modules/eval/ports.js';
import type { EvalCaseExecutionResult } from '../src/modules/eval/executor.js';
import { AppError, ConfigError } from '../src/platform/errors.js';
import { synthesizeFrozenDiff } from '../src/modules/eval/frozen-input.js';

/**
 * Hermetic service tests: an in-memory EvalRepository double, a structural
 * agent lookup, and a stubbed executor (no reviewer-core call, no LLM).
 */

const WS = 'ws-1';
const PATCH = `@@ -9,6 +9,10 @@ export const config = {
   port: 3000,
+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",
+  rateLimitMax: 100,
   cors: true,`;

const agent: AgentRecord = {
  id: 'ag-1',
  name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'v2 prompt',
  strategy: 'single-pass',
  version: 2,
  enabled: true,
};

class FakeRepo {
  cases: EvalCaseRow[] = [];
  runs: EvalRunRow[] = [];
  findings = new Map<string, FindingForCase>();
  patches = new Map<string, string>();
  private seq = 1;

  async insertCase(v: InsertEvalCase): Promise<EvalCaseRow> {
    if (v.sourceFindingId && this.cases.some((c) => c.sourceFindingId === v.sourceFindingId && c.ownerId === v.ownerId)) {
      throw Object.assign(new Error('duplicate'), { code: '23505' });
    }
    const row: EvalCaseRow = {
      id: `case-${this.seq++}`,
      workspaceId: v.workspaceId,
      ownerKind: v.ownerKind,
      ownerId: v.ownerId,
      name: v.name,
      inputDiff: v.inputDiff,
      inputFiles: v.inputFiles,
      inputMeta: v.inputMeta,
      expectedOutput: v.expectation,
      notes: v.notes ?? null,
      sourceFindingId: v.sourceFindingId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.cases.push(row);
    return row;
  }
  async getCase(_ws: string, id: string) {
    return this.cases.find((c) => c.id === id);
  }
  async getCaseBySourceFinding(_ws: string, findingId: string, _k: string, ownerId: string) {
    return this.cases.find((c) => c.sourceFindingId === findingId && c.ownerId === ownerId);
  }
  async listCasesForOwner(_ws: string, _k: string, ownerId: string) {
    return this.cases.filter((c) => c.ownerId === ownerId);
  }
  async countCasesByOwner() {
    const m = new Map<string, number>();
    for (const c of this.cases) m.set(c.ownerId, (m.get(c.ownerId) ?? 0) + 1);
    return m;
  }
  async updateCase(_ws: string, id: string, patch: Record<string, unknown>) {
    const row = this.cases.find((c) => c.id === id);
    if (!row) return undefined;
    Object.assign(row, patch.expectation ? { expectedOutput: patch.expectation } : {}, patch);
    return row;
  }
  async deleteCase(_ws: string, id: string) {
    const n = this.cases.length;
    this.cases = this.cases.filter((c) => c.id !== id);
    return this.cases.length < n;
  }
  async findingForCase(_ws: string, id: string) {
    return this.findings.get(id);
  }
  async filePatch(_prId: string, path: string) {
    return this.patches.get(path) ?? null;
  }
  async insertRun(v: InsertEvalRun): Promise<EvalRunRow> {
    const row: EvalRunRow = {
      id: `run-${this.seq++}`,
      workspaceId: v.workspaceId,
      ownerKind: v.ownerKind,
      ownerId: v.ownerId,
      scope: v.scope,
      status: 'running',
      agentVersion: v.agentVersion,
      caseIds: v.caseIds,
      ranAt: new Date(Date.now() + this.seq),
      finishedAt: null,
      perCase: [],
      casesErrored: 0,
      tracesPassed: null,
      tracesTotal: null,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: null,
      costUsd: null,
      errorReason: null,
    };
    this.runs.push(row);
    return row;
  }
  async getRun(_ws: string, id: string) {
    return this.runs.find((r) => r.id === id);
  }
  async getRuns(_ws: string, ids: string[]) {
    return this.runs.filter((r) => ids.includes(r.id));
  }
  async listRunsForOwner(_ws: string, _k: string, ownerId: string) {
    return this.runs.filter((r) => r.ownerId === ownerId).sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
  }
  async listRecentRuns(_ws: string, limit: number) {
    return this.runs.filter((r) => r.scope === 'suite').slice(-limit).reverse();
  }
  async listRunsForKind() {
    return this.runs.slice().sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
  }
  async activeRunForOwner(_ws: string, _k: string, ownerId: string) {
    return this.runs.find((r) => r.ownerId === ownerId && r.status === 'running');
  }
  async completeRun(id: string, v: CompleteEvalRun) {
    const row = this.runs.find((r) => r.id === id)!;
    Object.assign(row, {
      status: v.status,
      perCase: v.perCase,
      casesErrored: v.casesErrored,
      tracesPassed: v.tracesPassed,
      tracesTotal: v.tracesTotal,
      recall: v.recall,
      precision: v.precision,
      citationAccuracy: v.citationAccuracy,
      durationMs: v.durationMs,
      costUsd: v.costUsd,
      errorReason: v.errorReason ?? null,
      finishedAt: new Date(),
    });
  }
  async reconcileStaleRunning() {
    return 0;
  }
}

const agents: AgentLookup = {
  getById: async (_ws, id) => (id === agent.id ? agent : undefined),
  list: async () => [agent],
  getVersion: async (_id, version) => ({ version, configJson: { system_prompt: `v${version} prompt` } }),
};

const llm = { id: 'openai' } as unknown as LLMProvider;

function execResult(findings: EvalCaseExecutionResult['findings'], dropped = 0): EvalCaseExecutionResult {
  return {
    findings,
    groundingKept: findings.length,
    groundingTotal: findings.length + dropped,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    durationMs: 3,
    assembly: { system: '', skills: null, memory: null, specs: null, user: '' },
  };
}

function build(executor = { runCase: vi.fn(async () => execResult([])) }) {
  const repo = new FakeRepo();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new EvalService(repo as unknown as EvalRepository, agents, async () => llm, logger, executor);
  return { repo, service, executor, logger };
}

function seedFinding(repo: FakeRepo, id: string, triage: { acceptedAt?: Date; dismissedAt?: Date }, agentId: string | null = agent.id) {
  repo.findings.set(id, {
    finding: {
      id,
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      acceptedAt: triage.acceptedAt ?? null,
      dismissedAt: triage.dismissedAt ?? null,
    },
    agentId,
    prId: 'pr-1',
    prNumber: 482,
    prTitle: 'Add rate limiting',
    prBody: 'Wire up limiter',
  });
  repo.patches.set('src/config.ts', PATCH);
}

describe('EvalService.createCaseFromFinding', () => {
  it('accepted → must_find with a frozen single-file diff; second click is idempotent', async () => {
    const { repo, service } = build();
    seedFinding(repo, 'f1', { acceptedAt: new Date() });
    const first = await service.createCaseFromFinding(WS, 'f1');
    expect(first.created).toBe(true);
    expect(first.agentName).toBe('Security Reviewer');
    expect(first.case.expectation).toMatchObject({ type: 'must_find', file: 'src/config.ts', start_line: 11 });
    expect(first.case.input_diff).toBe(synthesizeFrozenDiff('src/config.ts', PATCH));
    expect(first.case.input_meta).toEqual({ pr_number: 482, title: 'Add rate limiting', body: 'Wire up limiter' });
    expect(first.case.name).toBe('hardcoded-stripe-secret-key');

    const second = await service.createCaseFromFinding(WS, 'f1');
    expect(second.created).toBe(false);
    expect(second.case.id).toBe(first.case.id);
    expect(repo.cases).toHaveLength(1);
  });

  it('dismissed → must_not_flag; the later triage decision wins', async () => {
    const { repo, service } = build();
    seedFinding(repo, 'f2', { dismissedAt: new Date() });
    expect((await service.createCaseFromFinding(WS, 'f2')).case.expectation.type).toBe('must_not_flag');

    seedFinding(repo, 'f3', { acceptedAt: new Date(1000), dismissedAt: new Date(2000) });
    expect((await service.createCaseFromFinding(WS, 'f3')).case.expectation.type).toBe('must_not_flag');
  });

  it('refuses an untriaged finding, a finding without an agent, and one without diff text', async () => {
    const { repo, service } = build();
    seedFinding(repo, 'f4', {});
    await expect(service.createCaseFromFinding(WS, 'f4')).rejects.toMatchObject({ code: 'finding_not_triaged', statusCode: 422 });

    seedFinding(repo, 'f5', { acceptedAt: new Date() }, null);
    await expect(service.createCaseFromFinding(WS, 'f5')).rejects.toMatchObject({ code: 'finding_has_no_agent' });

    seedFinding(repo, 'f6', { acceptedAt: new Date() });
    repo.patches.clear();
    await expect(service.createCaseFromFinding(WS, 'f6')).rejects.toMatchObject({ code: 'no_diff_available' });
  });

  it('refuses an expectation whose lines fall outside every hunk', async () => {
    const { repo, service } = build();
    seedFinding(repo, 'f7', { acceptedAt: new Date() });
    repo.findings.get('f7')!.finding.startLine = 90;
    repo.findings.get('f7')!.finding.endLine = 90;
    await expect(service.createCaseFromFinding(WS, 'f7')).rejects.toMatchObject({ code: 'expectation_not_grounded' });
  });
});

describe('EvalService runs', () => {
  async function withTwoCases() {
    const executor = {
      runCase: vi.fn(async () => execResult([{ file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 'key' }], 1)),
    };
    const built = build(executor);
    seedFinding(built.repo, 'f1', { acceptedAt: new Date() });
    await built.service.createCaseFromFinding(WS, 'f1');
    await built.service.createCase(WS, agent.id, {
      name: 'clean-block-no-flags',
      notes: null,
      input_diff: synthesizeFrozenDiff('src/config.ts', PATCH),
      input_files: ['src/config.ts'],
      input_meta: { pr_number: null, title: 'clean', body: null },
      expectation: { type: 'must_not_flag', file: 'src/config.ts', start_line: 12, end_line: 12 },
    });
    return built;
  }

  it('startRun executes every case in the background, scores it in code and completes the row', async () => {
    const { service, repo, executor } = await withTwoCases();
    const result = await service.startRun(WS, agent.id);
    expect(result.status).toBe('running');
    expect(result.scope).toBe('suite');
    expect(result.estimate).toEqual({ agents_total: 1, cases_total: 2, executions_total: 2 });
    await vi.waitFor(() => expect(repo.runs[0]!.status).toBe('completed'));

    expect(executor.runCase).toHaveBeenCalledTimes(2);
    const run = (await service.getRun(WS, result.run_id))!;
    expect(run.agent_version).toBe(2);
    expect(run.metrics!.recall).toBe(1); // must_find hit at line 11
    expect(run.metrics!.precision).toBe(1); // the must_not_flag case asked about line 12; finding is at 11 → no FP
    expect(run.metrics!.citation_accuracy).toBeCloseTo(2 / 4); // 1 kept of 2 emitted, twice
    expect(run.metrics!.traces_passed).toBe(2);
  });

  it('a subset run is scoped `case` and only the dashboard-irrelevant single case executes', async () => {
    const { service, repo, executor } = await withTwoCases();
    const only = repo.cases[1]!.id;
    const result = await service.startRun(WS, agent.id, [only]);
    expect(result.scope).toBe('case');
    await vi.waitFor(() => expect(repo.runs[0]!.status).toBe('completed'));
    expect(executor.runCase).toHaveBeenCalledTimes(1);
    expect(repo.runs[0]!.caseIds).toEqual([only]);
  });

  it('refuses a second run while one is in flight, and an agent with no cases', async () => {
    // A blocking executor keeps the first run `running` until we release it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const executor = { runCase: vi.fn(async () => (await gate, execResult([]))) };
    const { service, repo } = build(executor);
    seedFinding(repo, 'f1', { acceptedAt: new Date() });
    await service.createCaseFromFinding(WS, 'f1');

    await service.startRun(WS, agent.id);
    await expect(service.startRun(WS, agent.id)).rejects.toMatchObject({ code: 'run_in_flight', statusCode: 409 });
    release();
    await vi.waitFor(() => expect(repo.runs[0]!.status).toBe('completed'));
    repo.cases = [];
    await expect(service.startRun(WS, agent.id)).rejects.toMatchObject({ code: 'no_cases' });
  });

  it('a missing provider key is a stated 422 with no orphan run row', async () => {
    const repo = new FakeRepo();
    const service = new EvalService(
      repo as unknown as EvalRepository,
      agents,
      async () => {
        throw new ConfigError('OPENAI_API_KEY is not configured');
      },
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      { runCase: vi.fn() },
    );
    seedFinding(repo, 'f1', { acceptedAt: new Date() });
    await service.createCaseFromFinding(WS, 'f1');
    await expect(service.startRun(WS, agent.id)).rejects.toMatchObject({ code: 'provider_not_configured', statusCode: 422 });
    expect(repo.runs).toHaveLength(0);
  });

  it('a per-case executor failure marks that case errored and still completes the run', async () => {
    const executor = {
      runCase: vi
        .fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce(execResult([])),
    };
    const built = build(executor);
    seedFinding(built.repo, 'f1', { acceptedAt: new Date() });
    await built.service.createCaseFromFinding(WS, 'f1');
    seedFinding(built.repo, 'f2', { dismissedAt: new Date() });
    built.repo.findings.get('f2')!.finding.startLine = 12;
    built.repo.findings.get('f2')!.finding.endLine = 12;
    await built.service.createCaseFromFinding(WS, 'f2');

    const { run_id } = await built.service.startRun(WS, agent.id);
    await vi.waitFor(() => expect(built.repo.runs[0]!.status).toBe('completed'));
    const run = (await built.service.getRun(WS, run_id))!;
    expect(run.metrics!.cases_errored).toBe(1);
    expect(run.metrics!.recall).toBeNull(); // the only must_find case errored → not applicable
    expect(run.metrics!.per_case[0]).toMatchObject({ status: 'errored', error_reason: 'rate limited' });
  });

  it('runAll reports per-agent success/refusal and skips agents without cases', async () => {
    const { service } = build();
    const result = await service.runAll(WS);
    expect(result.estimate.agents_total).toBe(0);
    expect(result.started).toEqual([]);
  });
});

describe('EvalService reads', () => {
  async function withTwoRuns(secondFindings: EvalCaseExecutionResult['findings']) {
    const hit = [{ file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 'key' }];
    const executor = {
      runCase: vi
        .fn()
        .mockResolvedValueOnce(execResult([]))
        .mockResolvedValueOnce(execResult(secondFindings)),
    };
    const built = build(executor);
    seedFinding(built.repo, 'f1', { acceptedAt: new Date() });
    await built.service.createCaseFromFinding(WS, 'f1');
    const r1 = await built.service.startRun(WS, agent.id);
    await vi.waitFor(() => expect(built.repo.runs[0]!.status).toBe('completed'));
    // "edit the prompt" → bump version between runs
    const v3 = { ...agent, version: 3, systemPrompt: 'v3 prompt' };
    const lookup: AgentLookup = { ...agents, getById: async () => v3, list: async () => [v3] };
    const service = new EvalService(
      built.repo as unknown as EvalRepository,
      lookup,
      async () => llm,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      executor,
    );
    const r2 = await service.startRun(WS, agent.id);
    await vi.waitFor(() => expect(built.repo.runs[1]!.status).toBe('completed'));
    void hit;
    return { service, repo: built.repo, r1, r2 };
  }

  it('agentDetail exposes current metrics, delta vs previous, a callout and per-case outcomes', async () => {
    const { service, r2 } = await withTwoRuns([
      { file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 'key' },
    ]);
    const detail = await service.agentDetail(WS, agent.id, 30);
    expect(detail.cases_total).toBe(1);
    expect(detail.runs).toHaveLength(2);
    expect(detail.trend.map((p) => p.agent_version)).toEqual([2, 3]);
    expect(detail.current!.recall).toBe(1);
    expect(detail.current_version).toBe(3);
    expect(detail.delta.recall).toBe(1);
    expect(detail.callout).toMatchObject({ metric: 'recall', direction: 'up', agent_version: 3 });
    expect(detail.callout!.case_transitions).toHaveLength(1);
    const caseId = Object.keys(detail.case_outcomes)[0]!;
    expect(detail.case_outcomes[caseId]!.pass).toBe(true);
    void r2;
  });

  it('dashboard lists every agent with its latest suite run and the recent-runs table', async () => {
    const { service } = await withTwoRuns([]);
    const dash = await service.dashboard(WS);
    expect(dash.agents).toHaveLength(1);
    expect(dash.agents[0]!.runs_total).toBe(2);
    expect(dash.agents[0]!.latest!.agent_version).toBe(3);
    expect(dash.agents[0]!.trend).toHaveLength(2);
    expect(dash.recent_runs).toHaveLength(2);
    expect(dash.recent_runs[0]!.agent_name).toBe('Security Reviewer');
  });

  it('compare orders old → new, computes deltas over common cases and diffs the system prompts', async () => {
    const { service, r1, r2 } = await withTwoRuns([
      { file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 'key' },
    ]);
    const cmp = await service.compare(WS, r2.run_id, r1.run_id);
    expect(cmp.a.id).toBe(r1.run_id);
    expect(cmp.b.id).toBe(r2.run_id);
    expect(cmp.deltas.recall).toBe(1);
    expect(cmp.common_case_ids).toHaveLength(1);
    expect(cmp.prompt_a).toBe('v2 prompt');
    expect(cmp.prompt_b).toBe('v3 prompt');
    expect(cmp.prompt_diff).toEqual([
      { kind: 'removed', text: 'v2 prompt' },
      { kind: 'added', text: 'v3 prompt' },
    ]);
    expect(cmp.case_transitions).toEqual([expect.objectContaining({ from: false, to: true })]);
  });

  it('compare falls back to the live prompt when the current version has no snapshot', async () => {
    const { repo, r1 } = await withTwoRuns([]);
    // No snapshot for v3 (the agent's CURRENT version) → live prompt is used; v2 still from its snapshot.
    const v3 = { ...agent, version: 3, systemPrompt: 'live v3 prompt' };
    const lookup: AgentLookup = {
      getById: async () => v3,
      list: async () => [v3],
      getVersion: async (_id, version) => (version === 2 ? { version, configJson: { system_prompt: 'v2 prompt' } } : undefined),
    };
    const service = new EvalService(repo as unknown as EvalRepository, lookup, async () => llm, { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, { runCase: vi.fn() });
    const cmp = await service.compare(WS, r1.run_id, repo.runs[1]!.id);
    expect(cmp.prompt_a).toBe('v2 prompt');
    expect(cmp.prompt_b).toBe('live v3 prompt');
    expect(cmp.prompt_diff.some((l) => l.kind === 'added' && l.text === 'live v3 prompt')).toBe(true);
  });

  it('compare refuses runs of different agents', async () => {
    const { service, repo, r1 } = await withTwoRuns([]);
    repo.runs[1]!.ownerId = 'someone-else';
    await expect(service.compare(WS, r1.run_id, repo.runs[1]!.id)).rejects.toBeInstanceOf(AppError);
  });
});
