/**
 * multi-agent — application service (ring 2). Starts a multi-agent run (rows
 * first, execution in the background), reads it back with groups and conflicts
 * computed on the fly, and serves per-agent estimates.
 */
import type { AgentEstimates, MultiAgentRun, MultiAgentRunStarted } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { ESTIMATE_SAMPLE, MAX_AGENTS, MIN_AGENTS } from './constants.js';
import { buildMultiAgentRun, toEstimate } from './helpers.js';
import type { Logger, MultiAgentDeps } from './ports.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MultiAgentService {
  constructor(private readonly deps: MultiAgentDeps) {}

  async start(workspaceId: string, prId: string, agentIds: string[], logger?: Logger): Promise<MultiAgentRunStarted> {
    if (agentIds.length < MIN_AGENTS || agentIds.length > MAX_AGENTS) {
      throw new AppError('invalid_agent_selection', `Select between ${MIN_AGENTS} and ${MAX_AGENTS} agents`, 400);
    }
    if (new Set(agentIds).size !== agentIds.length) {
      throw new AppError('invalid_agent_selection', 'Each agent can be selected once', 400);
    }
    // Non-UUID ids are unknown agents; they never reach Postgres.
    if (agentIds.some((id) => !UUID.test(id))) throw new NotFoundError('Agent not found');

    const pull = await this.deps.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const found = await this.deps.repo.findAgents(workspaceId, agentIds);
    const byId = new Map(found.map((a) => [a.id, a]));
    const agents = agentIds.map((id) => byId.get(id));
    if (agents.some((a) => !a)) throw new NotFoundError('Agent not found');

    const created = await this.deps.repo.createMultiRun(workspaceId, prId, agents as NonNullable<(typeof agents)[number]>[]);
    // Fire-and-forget: the response returns with the run ids; the client follows each run's events.
    const queued = created.runs.map((r) => ({ agentId: r.agent_id, runId: r.run_id }));
    void this.deps.runner
      .executeQueued(workspaceId, prId, queued, { concurrency: this.deps.concurrency, ...(logger ? { logger } : {}) })
      .catch((err: Error) => {
        logger?.error({ prId, multiRunId: created.multiRunId, err: err.message }, 'multi-agent: background execution crashed');
      });
    return { multi_run_id: created.multiRunId, pr_id: prId, runs: created.runs };
  }

  async get(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const data = await this.deps.repo.getMultiRun(workspaceId, id);
    if (!data) throw new NotFoundError('Multi-agent run not found');
    return buildMultiAgentRun(data, this.deps.lineTolerance);
  }

  async latest(workspaceId: string, prId: string): Promise<MultiAgentRun> {
    const data = await this.deps.repo.latestForPull(workspaceId, prId);
    if (!data) throw new NotFoundError('No multi-agent run for this pull request');
    return buildMultiAgentRun(data, this.deps.lineTolerance);
  }

  async estimates(workspaceId: string): Promise<AgentEstimates> {
    const [ids, rows] = await Promise.all([
      this.deps.repo.listAgentIds(workspaceId),
      this.deps.repo.estimateRows(workspaceId, ESTIMATE_SAMPLE),
    ]);
    return {
      concurrency: this.deps.concurrency,
      agents: ids.map((id) =>
        toEstimate(
          id,
          rows.filter((r) => r.agentId === id),
        ),
      ),
    };
  }
}
