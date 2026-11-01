/**
 * multi-agent — HTTP driving adapter (ring 3b).
 *
 *   POST /pulls/:id/multi-agent-run  {agent_ids} → start a run (rows now, models in the background)
 *   GET  /pulls/:id/multi-agent                  → the latest multi-agent run of the PR
 *   GET  /multi-agent-runs/:id                   → one multi-agent run
 *   GET  /multi-agent/estimates                  → per-agent duration/cost estimates
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentEstimates, MultiAgentRun, MultiAgentRunRequest, MultiAgentRunStarted } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { LINE_TOLERANCE, MULTI_AGENT_CONCURRENCY, RATE_LIMIT } from './constants.js';
import { MultiAgentService } from './service.js';

export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const c = app.container;
  const service = new MultiAgentService({
    repo: c.multiAgentRepo,
    runner: c.reviewRunner,
    concurrency: MULTI_AGENT_CONCURRENCY,
    lineTolerance: LINE_TOLERANCE,
  });

  app.post(
    '/pulls/:id/multi-agent-run',
    {
      schema: { params: IdParams, body: MultiAgentRunRequest, response: { 200: MultiAgentRunStarted } },
      config: { rateLimit: RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.start(workspaceId, req.params.id, req.body.agent_ids, req.log);
    },
  );

  app.get(
    '/pulls/:id/multi-agent',
    { schema: { params: IdParams, response: { 200: MultiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.latest(workspaceId, req.params.id);
    },
  );

  app.get(
    '/multi-agent-runs/:id',
    { schema: { params: IdParams, response: { 200: MultiAgentRun } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.get(
    '/multi-agent/estimates',
    { schema: { response: { 200: AgentEstimates } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.estimates(workspaceId);
    },
  );
}
