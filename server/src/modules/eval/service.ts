import type {
  EvalAgentDetail,
  EvalAgentSummary,
  EvalCase,
  EvalCaseInput,
  EvalCaseOutcome,
  EvalCompare,
  EvalDashboard,
  EvalExpectation,
  EvalRun,
  EvalRunAllResult,
  EvalRunEstimate,
  EvalRunRecord,
  EvalRunResult,
  EvalRunScope,
  EvalTrendPoint,
  LLMProvider,
} from '@devdigest/shared';
import { AppError, ConfigError, NotFoundError } from '../../platform/errors.js';
import { EvalRepository, type EvalCaseRow, type EvalRunRow } from './repository.js';
import { isExpectationGrounded, slugify, synthesizeFrozenDiff } from './frozen-input.js';
import {
  caseTransitions,
  errorCaseOutcome,
  metricDeltas,
  metricsOverCases,
  scoreCase,
  scoreRun,
} from './scoring.js';
import { EvalExecutor } from './executor.js';
import { diffLines } from './prompt-diff.js';
import { buildCallout } from './callout.js';
import {
  DASHBOARD_RECENT_RUNS_LIMIT,
  DASHBOARD_TREND_LIMIT,
  MAX_FROZEN_DIFF_BYTES,
  STALE_RUN_TIMEOUT_MS,
} from './constants.js';
import type { AgentLookup, AgentRecord, LlmResolver, Logger } from './ports.js';

/**
 * Eval Pipeline business logic. Three concerns:
 *  1. cases — frozen from a triaged finding (one click) or hand-authored;
 *  2. runs  — an agent version replayed over its case set in the background,
 *             scored in code (`scoring.ts`), polled by the client;
 *  3. reads — dashboard, per-agent detail (trend/delta/callout), compare.
 */

export interface CaseEditInput {
  name?: string;
  notes?: string | null;
  input_diff?: string;
  input_files?: string[];
  input_meta?: EvalCaseInput['input_meta'];
  expectation?: EvalExpectation;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff,
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expectation: row.expectedOutput,
    source_finding_id: row.sourceFindingId,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function runRowMetrics(row: EvalRunRow): EvalRun {
  return {
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    traces_passed: row.tracesPassed ?? 0,
    traces_total: row.tracesTotal ?? 0,
    cases_errored: row.casesErrored,
    duration_ms: row.durationMs ?? 0,
    cost_usd: row.costUsd,
    per_case: row.perCase,
  };
}

function toRunRecord(row: EvalRunRow, agentName: string | null): EvalRunRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    agent_name: agentName,
    scope: row.scope,
    status: row.status,
    started_at: row.ranAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    agent_version: row.agentVersion,
    case_ids: row.caseIds,
    metrics: row.status === 'running' ? null : runRowMetrics(row),
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    error_reason: row.errorReason,
  };
}

function toTrendPoint(row: EvalRunRow): EvalTrendPoint {
  const total = row.tracesTotal ?? 0;
  const passed = row.tracesPassed ?? 0;
  return {
    run_id: row.id,
    ran_at: row.ranAt.toISOString(),
    agent_version: row.agentVersion,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    pass_rate: total > 0 ? passed / total : 0,
    cost_usd: row.costUsd,
  };
}

const isCompletedSuite = (r: EvalRunRow) => r.status === 'completed' && r.scope === 'suite';

export class EvalService {
  constructor(
    private repo: EvalRepository,
    private agents: AgentLookup,
    private resolveLlm: LlmResolver,
    private logger: Logger,
    private executor: Pick<EvalExecutor, 'runCase'> = new EvalExecutor(),
    private now: () => Date = () => new Date(),
  ) {}

  // ===========================================================================
  // Cases
  // ===========================================================================

  /**
   * "Turn into eval case" — one click on a triaged finding. accepted →
   * `must_find`, dismissed → `must_not_flag` (when both are set, the later
   * decision wins). Idempotent per (finding, agent): a second click returns
   * the existing case with `created: false`.
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ case: EvalCase; created: boolean; agentName: string | null }> {
    const ctx = await this.repo.findingForCase(workspaceId, findingId);
    if (!ctx) throw new NotFoundError('Finding not found');

    const { acceptedAt, dismissedAt } = ctx.finding;
    if (!acceptedAt && !dismissedAt) {
      throw new AppError(
        'finding_not_triaged',
        'Accept or dismiss this finding before turning it into an eval case.',
        422,
      );
    }
    if (!ctx.agentId) {
      throw new AppError(
        'finding_has_no_agent',
        'This finding has no owning agent, so no eval case can be created for it.',
        422,
      );
    }
    const agent = await this.agents.getById(workspaceId, ctx.agentId);
    const agentName = agent?.name ?? null;

    const existing = await this.repo.getCaseBySourceFinding(workspaceId, findingId, 'agent', ctx.agentId);
    if (existing) return { case: toEvalCaseDto(existing), created: false, agentName };

    const type: EvalExpectation['type'] =
      acceptedAt && dismissedAt
        ? acceptedAt.getTime() >= dismissedAt.getTime()
          ? 'must_find'
          : 'must_not_flag'
        : acceptedAt
          ? 'must_find'
          : 'must_not_flag';

    const patch = await this.repo.filePatch(ctx.prId, ctx.finding.file);
    if (!patch) {
      throw new AppError(
        'no_diff_available',
        `No diff text is available for '${ctx.finding.file}' on this pull request, so no frozen input could be captured.`,
        422,
      );
    }
    const frozenDiff = synthesizeFrozenDiff(ctx.finding.file, patch);
    this.assertDiffSize(frozenDiff);

    const expectation: EvalExpectation = {
      type,
      file: ctx.finding.file,
      start_line: ctx.finding.startLine,
      end_line: ctx.finding.endLine,
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      title: ctx.finding.title,
    };
    this.assertGrounded(frozenDiff, expectation);

    try {
      const row = await this.repo.insertCase({
        workspaceId,
        ownerKind: 'agent',
        ownerId: ctx.agentId,
        name: slugify(ctx.finding.title),
        inputDiff: frozenDiff,
        inputFiles: [ctx.finding.file],
        inputMeta: { pr_number: ctx.prNumber, title: ctx.prTitle, body: ctx.prBody },
        expectation,
        notes: null,
        sourceFindingId: findingId,
      });
      return { case: toEvalCaseDto(row), created: true, agentName };
    } catch (err) {
      // Two rapid clicks both passing the pre-check resolve to the SAME case.
      if (isUniqueViolation(err)) {
        const race = await this.repo.getCaseBySourceFinding(workspaceId, findingId, 'agent', ctx.agentId);
        if (race) return { case: toEvalCaseDto(race), created: false, agentName };
      }
      throw err;
    }
  }

  /** Hand-authored case for an agent (the "New eval case" modal). */
  async createCase(workspaceId: string, agentId: string, input: EvalCaseInput): Promise<EvalCase> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    this.assertDiffSize(input.input_diff);
    this.assertGrounded(input.input_diff, input.expectation);

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectation: input.expectation,
      notes: input.notes ?? null,
      sourceFindingId: null,
    });
    return toEvalCaseDto(row);
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const rows = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    return rows.map(toEvalCaseDto);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getCase(workspaceId, id);
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** Re-runs the same size + grounding validation on whatever changed.
   *  Never touches stored runs. */
  async updateCase(workspaceId: string, id: string, patch: CaseEditInput): Promise<EvalCase | undefined> {
    const existing = await this.repo.getCase(workspaceId, id);
    if (!existing) return undefined;

    if (patch.input_diff !== undefined || patch.expectation !== undefined) {
      const nextDiff = patch.input_diff ?? existing.inputDiff;
      const nextExpectation = patch.expectation ?? existing.expectedOutput;
      this.assertDiffSize(nextDiff);
      this.assertGrounded(nextDiff, nextExpectation);
    }

    const row = await this.repo.updateCase(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expectation !== undefined ? { expectation: patch.expectation } : {}),
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, id);
  }

  private assertDiffSize(diff: string): void {
    if (Buffer.byteLength(diff, 'utf8') > MAX_FROZEN_DIFF_BYTES) {
      throw new AppError(
        'frozen_diff_too_large',
        'This diff is too large to freeze as an eval case.',
        422,
      );
    }
  }

  private assertGrounded(diff: string, expectation: EvalExpectation): void {
    if (!isExpectationGrounded(diff, expectation)) {
      throw new AppError(
        'expectation_not_grounded',
        'The expected lines do not fall within any hunk of the frozen diff, so no finding could ever match them.',
        422,
      );
    }
  }

  // ===========================================================================
  // Runs
  // ===========================================================================

  /**
   * Start a run: suite (all cases) or a subset (`caseIds` → scope `case`).
   * Returns immediately; execution continues in the background and the
   * client polls `GET /eval/runs/:id`.
   */
  async startRun(workspaceId: string, agentId: string, caseIds?: string[]): Promise<EvalRunResult> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // A restart can never deadlock this agent's runs.
    await this.repo.reconcileStaleRunning(new Date(this.now().getTime() - STALE_RUN_TIMEOUT_MS), {
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
    });
    const active = await this.repo.activeRunForOwner(workspaceId, 'agent', agentId);
    if (active) {
      throw new AppError('run_in_flight', 'An eval run is already in progress for this agent.', 409);
    }

    let cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    let scope: EvalRunScope = 'suite';
    if (caseIds && caseIds.length > 0) {
      const wanted = new Set(caseIds);
      cases = cases.filter((c) => wanted.has(c.id));
      if (cases.length !== wanted.size) {
        throw new AppError('unknown_case', 'One of the requested cases does not belong to this agent.', 422);
      }
      scope = 'case';
    }
    if (cases.length === 0) {
      throw new AppError('no_cases', 'This agent has no eval cases to run.', 422);
    }

    // Resolve the LLM BEFORE creating the run row — a missing key is a
    // stated 422 with no orphan record left behind.
    let llm: LLMProvider;
    try {
      llm = await this.resolveLlm(agent.provider);
    } catch (err) {
      if (err instanceof ConfigError) {
        throw new AppError(
          'provider_not_configured',
          `No API key is configured for provider '${agent.provider}'.`,
          422,
        );
      }
      throw err;
    }

    const run = await this.repo.insertRun({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      scope,
      agentVersion: agent.version,
      caseIds: cases.map((c) => c.id),
    });

    void this.executeRun(agent, llm, run.id, cases).catch((err) => {
      this.logger.error({ runId: run.id, err: (err as Error).message }, 'eval: background execution crashed');
    });

    const estimate: EvalRunEstimate = {
      agents_total: 1,
      cases_total: cases.length,
      executions_total: cases.length,
    };
    return { run_id: run.id, status: 'running', scope, estimate };
  }

  /** Exposed for tests; callers use `startRun`. */
  async executeRun(agent: AgentRecord, llm: LLMProvider, runId: string, cases: EvalCaseRow[]): Promise<void> {
    const started = this.now().getTime();
    const outcomes: EvalCaseOutcome[] = [];
    try {
      for (const c of cases) {
        const caseStarted = this.now().getTime();
        const expectation = c.expectedOutput;
        try {
          const result = await this.executor.runCase(agent, llm, {
            inputDiff: c.inputDiff,
            inputMeta: c.inputMeta,
          });
          outcomes.push(
            scoreCase({
              caseId: c.id,
              name: c.name,
              expectation,
              findings: result.findings,
              groundingKept: result.groundingKept,
              groundingTotal: result.groundingTotal,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
            }),
          );
        } catch (err) {
          // A per-case failure completes the run; the case is errored and
          // excluded from every metric.
          outcomes.push(
            errorCaseOutcome(
              c.id,
              c.name,
              expectation.type,
              (err as Error).message,
              this.now().getTime() - caseStarted,
            ),
          );
        }
      }

      const metrics = scoreRun(outcomes, this.now().getTime() - started);
      await this.repo.completeRun(runId, {
        status: 'completed',
        perCase: metrics.per_case,
        casesErrored: metrics.cases_errored,
        tracesPassed: metrics.traces_passed,
        tracesTotal: metrics.traces_total,
        recall: metrics.recall,
        precision: metrics.precision,
        citationAccuracy: metrics.citation_accuracy,
        durationMs: metrics.duration_ms,
        costUsd: metrics.cost_usd,
      });
      // Logs carry counts/metrics/model/cost only — never diff or finding prose.
      this.logger.info(
        {
          runId,
          agentId: agent.id,
          agentVersion: agent.version,
          casesTotal: cases.length,
          casesErrored: metrics.cases_errored,
          recall: metrics.recall,
          precision: metrics.precision,
          citationAccuracy: metrics.citation_accuracy,
          model: agent.model,
          durationMs: metrics.duration_ms,
          costUsd: metrics.cost_usd,
        },
        'eval run completed',
      );
    } catch (err) {
      await this.repo.completeRun(runId, {
        status: 'errored',
        perCase: outcomes,
        casesErrored: outcomes.length,
        tracesPassed: null,
        tracesTotal: null,
        recall: null,
        precision: null,
        citationAccuracy: null,
        durationMs: this.now().getTime() - started,
        costUsd: null,
        errorReason: (err as Error).message,
      });
      this.logger.error({ runId, err: (err as Error).message }, 'eval run crashed');
    }
  }

  /** Suite runs for every enabled agent that owns ≥1 case — per-agent
   *  success or refusal, never one combined verdict. */
  async runAll(workspaceId: string): Promise<EvalRunAllResult> {
    const agents = (await this.agents.list(workspaceId)).filter((a) => a.enabled);
    const counts = await this.repo.countCasesByOwner(workspaceId, 'agent');
    const relevant = agents.filter((a) => (counts.get(a.id) ?? 0) > 0);

    const started: EvalRunAllResult['started'] = [];
    let executionsTotal = 0;
    let casesTotal = 0;
    for (const agent of relevant) {
      casesTotal += counts.get(agent.id) ?? 0;
      try {
        const result = await this.startRun(workspaceId, agent.id);
        executionsTotal += result.estimate.executions_total;
        started.push({ agent_id: agent.id, agent_name: agent.name, run_id: result.run_id, refused_reason: null });
      } catch (err) {
        started.push({
          agent_id: agent.id,
          agent_name: agent.name,
          run_id: null,
          refused_reason: err instanceof AppError ? err.message : 'Failed to start this agent’s run.',
        });
      }
    }
    return {
      estimate: { agents_total: relevant.length, cases_total: casesTotal, executions_total: executionsTotal },
      started,
    };
  }

  async getRun(workspaceId: string, id: string): Promise<EvalRunRecord | undefined> {
    const row = await this.repo.getRun(workspaceId, id);
    if (!row) return undefined;
    const agent = await this.agents.getById(workspaceId, row.ownerId);
    return toRunRecord(row, agent?.name ?? null);
  }

  async listRuns(workspaceId: string, agentId: string): Promise<EvalRunRecord[]> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listRunsForOwner(workspaceId, 'agent', agentId);
    return rows.map((r) => toRunRecord(r, agent.name));
  }

  // ===========================================================================
  // Reads: dashboard, detail, compare
  // ===========================================================================

  async dashboard(workspaceId: string): Promise<EvalDashboard> {
    const agents = await this.agents.list(workspaceId);
    const names = new Map(agents.map((a) => [a.id, a.name]));
    const counts = await this.repo.countCasesByOwner(workspaceId, 'agent');
    const allRuns = await this.repo.listRunsForKind(workspaceId, 'agent');
    const byAgent = new Map<string, EvalRunRow[]>();
    for (const r of allRuns) {
      const list = byAgent.get(r.ownerId) ?? [];
      list.push(r);
      byAgent.set(r.ownerId, list);
    }

    const summaries: EvalAgentSummary[] = agents.map((a) => {
      const runs = (byAgent.get(a.id) ?? []).filter((r) => r.scope === 'suite');
      const completed = runs.filter(isCompletedSuite);
      const latest = completed[0] ?? null;
      const trend = completed.slice(0, DASHBOARD_TREND_LIMIT).reverse().map(toTrendPoint);
      return {
        agent_id: a.id,
        agent_name: a.name,
        provider: a.provider,
        model: a.model,
        version: a.version,
        enabled: a.enabled,
        cases_total: counts.get(a.id) ?? 0,
        runs_total: completed.length,
        latest: latest ? toRunRecord(latest, a.name) : null,
        trend,
      };
    });
    // Agents with eval activity first, then the rest alphabetically.
    summaries.sort((x, y) => {
      const ax = x.runs_total > 0 || x.cases_total > 0 ? 0 : 1;
      const ay = y.runs_total > 0 || y.cases_total > 0 ? 0 : 1;
      return ax - ay || x.agent_name.localeCompare(y.agent_name);
    });

    const recent = await this.repo.listRecentRuns(workspaceId, DASHBOARD_RECENT_RUNS_LIMIT);
    return {
      agents: summaries,
      recent_runs: recent.map((r) => toRunRecord(r, names.get(r.ownerId) ?? null)),
    };
  }

  /** One agent's eval detail within a window of `days` (null = all time). */
  async agentDetail(workspaceId: string, agentId: string, days: number | null): Promise<EvalAgentDetail> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    const since = days ? new Date(this.now().getTime() - days * 86_400_000) : undefined;
    const rows = await this.repo.listRunsForOwner(workspaceId, 'agent', agentId, since);
    const suiteRows = rows.filter((r) => r.scope === 'suite');
    const completed = suiteRows.filter(isCompletedSuite);
    const latest = completed[0] ?? null;
    const previous = completed[1] ?? null;

    const current = latest ? runRowMetrics(latest) : null;
    const delta =
      latest && previous
        ? metricDeltas(runRowMetrics(previous), runRowMetrics(latest))
        : { recall: null, precision: null, citation_accuracy: null };
    const callout =
      latest && previous
        ? buildCallout(
            { metrics: runRowMetrics(latest), agentVersion: latest.agentVersion },
            { metrics: runRowMetrics(previous) },
          )
        : null;

    // Most recent outcome per case across EVERY completed run (any scope),
    // restricted to cases that still exist.
    const caseIds = new Set(cases.map((c) => c.id));
    const caseOutcomes: Record<string, EvalCaseOutcome> = {};
    for (const r of rows) {
      if (r.status !== 'completed') continue;
      for (const o of r.perCase) {
        if (caseIds.has(o.case_id) && !(o.case_id in caseOutcomes)) caseOutcomes[o.case_id] = o;
      }
    }

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      provider: agent.provider,
      model: agent.model,
      version: agent.version,
      cases_total: cases.length,
      runs: suiteRows.map((r) => toRunRecord(r, agent.name)),
      trend: completed.slice().reverse().map(toTrendPoint),
      current,
      current_version: latest?.agentVersion ?? null,
      delta,
      callout,
      case_outcomes: caseOutcomes,
    };
  }

  /** Two runs of the same agent side by side: older → newer. */
  async compare(workspaceId: string, runIdA: string, runIdB: string): Promise<EvalCompare> {
    const rows = await this.repo.getRuns(workspaceId, [runIdA, runIdB]);
    const rowA = rows.find((r) => r.id === runIdA);
    const rowB = rows.find((r) => r.id === runIdB);
    if (!rowA || !rowB) throw new NotFoundError('Eval run not found');
    if (rowA.ownerId !== rowB.ownerId) {
      throw new AppError('different_owners', 'Only runs of the same agent can be compared.', 422);
    }
    if (rowA.status !== 'completed' || rowB.status !== 'completed') {
      throw new AppError('run_not_completed', 'Both runs must be completed to compare them.', 422);
    }
    const [older, newer] = rowA.ranAt.getTime() <= rowB.ranAt.getTime() ? [rowA, rowB] : [rowB, rowA];
    const agent = await this.agents.getById(workspaceId, older.ownerId);
    const agentName = agent?.name ?? null;

    const olderMetrics = runRowMetrics(older);
    const newerMetrics = runRowMetrics(newer);
    const idsA = new Set(olderMetrics.per_case.map((c) => c.case_id));
    const idsB = new Set(newerMetrics.per_case.map((c) => c.case_id));
    const common = [...idsA].filter((id) => idsB.has(id));
    const commonSet = new Set(common);
    const a = metricsOverCases(olderMetrics, commonSet);
    const b = metricsOverCases(newerMetrics, commonSet);

    const promptA = await this.promptForVersion(workspaceId, older.ownerId, older.agentVersion);
    const promptB = await this.promptForVersion(workspaceId, newer.ownerId, newer.agentVersion);

    return {
      a: toRunRecord(older, agentName),
      b: toRunRecord(newer, agentName),
      deltas: {
        ...metricDeltas(a, b),
        cost_usd: a.cost_usd == null || b.cost_usd == null ? null : b.cost_usd - a.cost_usd,
      },
      common_case_ids: common,
      only_in_a: [...idsA].filter((id) => !idsB.has(id)),
      only_in_b: [...idsB].filter((id) => !idsA.has(id)),
      case_transitions: caseTransitions(a, b),
      prompt_a: promptA,
      prompt_b: promptB,
      prompt_diff: promptA != null && promptB != null ? diffLines(promptA, promptB) : [],
    };
  }

  /** The system prompt an agent version ran with — from its `agent_versions`
   *  snapshot, or the live prompt when the snapshot is missing but the agent
   *  still sits on that version (agents inserted outside the repository, e.g.
   *  older seeds, have no version-1 row). */
  private async promptForVersion(workspaceId: string, agentId: string, version: number | null): Promise<string | null> {
    if (version == null) return null;
    const snapshot = await this.agents.getVersion(agentId, version);
    const cfg = snapshot?.configJson as { system_prompt?: unknown } | null | undefined;
    if (typeof cfg?.system_prompt === 'string') return cfg.system_prompt;
    const agent = await this.agents.getById(workspaceId, agentId);
    return agent && agent.version === version ? agent.systemPrompt : null;
  }
}
