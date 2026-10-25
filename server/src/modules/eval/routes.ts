import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalRunInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { DEFAULT_DETAIL_DAYS, RUN_RATE_LIMIT } from './constants.js';
import { EvalRepository } from './repository.js';
import { EvalService } from './service.js';

/**
 * eval module — the Eval Pipeline (L06).
 *   POST   /findings/:id/eval-case       → freeze a triaged finding into a case (201 / 200 if it exists)
 *   GET    /agents/:id/eval/cases        → the agent's case set
 *   POST   /agents/:id/eval/cases        → hand-authored case
 *   GET    /eval/cases/:id               → one case
 *   PATCH  /eval/cases/:id               → edit (re-validated)
 *   DELETE /eval/cases/:id
 *   POST   /agents/:id/eval/runs         → start a run (suite, or `case_ids` subset) — 202, poll
 *   GET    /agents/:id/eval/runs         → the agent's run history
 *   GET    /eval/runs/:id                → one run (status + metrics)
 *   POST   /eval/runs/all                → suite run for every enabled agent with cases
 *   GET    /eval/dashboard               → per-agent summary + recent runs
 *   GET    /eval/agents/:id?days=30      → one agent's detail (trend, delta, callout, case outcomes)
 *   GET    /eval/compare?a=&b=           → two runs side by side + system prompt diff
 */

const EvalCaseEditBody = EvalCaseInput.partial();
const RunAllBody = z.object({ confirm: z.literal(true) });
const CompareQuery = z
  .object({ a: z.string().uuid(), b: z.string().uuid() })
  .refine((q) => q.a !== q.b, { message: 'Select two distinct runs to compare.' });
const DetailQuery = z.object({
  /** Window in days; `all` (or 0) disables the window. */
  days: z
    .union([z.literal('all'), z.coerce.number().int().min(0)])
    .optional()
    .default(DEFAULT_DETAIL_DAYS),
});

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(
    new EvalRepository(container.db),
    container.agentsRepo,
    (provider) => container.llm(provider),
    app.log,
  );

  // ---- cases ---------------------------------------------------------------
  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.createCaseFromFinding(workspaceId, req.params.id);
    reply.status(result.created ? 201 : 200);
    return { case: result.case, created: result.created, agent_name: result.agentName };
  });

  app.get('/agents/:id/eval/cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval/cases',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return evalCase;
    },
  );

  app.get('/eval/cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.getCase(workspaceId, req.params.id);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.patch('/eval/cases/:id', { schema: { params: IdParams, body: EvalCaseEditBody } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.delete('/eval/cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  // ---- runs ----------------------------------------------------------------
  app.post(
    '/agents/:id/eval/runs',
    { schema: { params: IdParams, body: EvalRunInput.optional() }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.startRun(workspaceId, req.params.id, req.body?.case_ids);
      reply.status(202);
      return result;
    },
  );

  app.get('/agents/:id/eval/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  app.get('/eval/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const run = await service.getRun(workspaceId, req.params.id);
    if (!run) throw new NotFoundError('Eval run not found');
    return run;
  });

  app.post('/eval/runs/all', { schema: { body: RunAllBody }, config: { rateLimit: RUN_RATE_LIMIT } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.runAll(workspaceId);
  });

  // ---- reads ---------------------------------------------------------------
  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.dashboard(workspaceId);
  });

  app.get('/eval/agents/:id', { schema: { params: IdParams, querystring: DetailQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const days = req.query.days === 'all' || req.query.days === 0 ? null : req.query.days;
    return service.agentDetail(workspaceId, req.params.id, days);
  });

  app.get('/eval/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.compare(workspaceId, req.query.a, req.query.b);
  });
}
