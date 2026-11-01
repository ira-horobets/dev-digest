/**
 * ci — HTTP driving adapter (ring 3b).
 *
 *   POST /agents/:id/ci/preview                           → CiPreview
 *   GET  /agents/:id/ci/secrets?repo=                     → CiSecretsView
 *   POST /agents/:id/export-ci                            → CiExport
 *   GET  /agents/:id/ci/installations                     → CiInstallationsView
 *   POST /agents/:id/ci/installations/:installationId/update → CiUpdateResult
 *   GET  /ci/runs                                         → { runs: CiRun[] }
 *   POST /ci/runs/refresh                                 → CiRunsRefreshResult
 *
 * No route accepts a pushed result: runs are read from GitHub only.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiExport,
  CiExportInput,
  CiInstallationsView,
  CiPreview,
  CiPreviewInput,
  CiRun,
  CiRunsQuery,
  CiRunsRefreshResult,
  CiSecretsView,
  CiUpdateResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { loadRunnerBundle } from '../../platform/runner-bundle.js';
import { EXPORT_BODY_LIMIT, RATE_LIMIT } from './constants.js';
import { CiRunsService } from './ingest.js';
import { CiService } from './service.js';

const InstallationParams = z.object({ id: z.string().uuid(), installationId: z.string().uuid() });
const SecretsQuery = z.object({ repo: z.string().min(1).max(200) });

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const c = app.container;
  const deps = {
    repo: c.ciRepo,
    github: () => c.github(),
    hasGithubToken: async () => !!(await c.secrets.get('GITHUB_TOKEN')),
    runnerBundle: loadRunnerBundle,
    now: () => new Date(),
  };
  const service = new CiService(deps);
  const runs = new CiRunsService(deps);

  app.post(
    '/agents/:id/ci/preview',
    { schema: { params: IdParams, body: CiPreviewInput, response: { 200: CiPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/agents/:id/ci/secrets',
    { schema: { params: IdParams, querystring: SecretsQuery, response: { 200: CiSecretsView } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.secrets(workspaceId, req.params.id, req.query.repo);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } },
      bodyLimit: EXPORT_BODY_LIMIT,
      config: { rateLimit: RATE_LIMIT.export },
    },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.exportCi(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/agents/:id/ci/installations',
    { schema: { params: IdParams, response: { 200: CiInstallationsView } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.installations(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/ci/installations/:installationId/update',
    {
      schema: { params: InstallationParams, response: { 200: CiUpdateResult } },
      config: { rateLimit: RATE_LIMIT.update },
    },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return service.update(workspaceId, req.params.id, req.params.installationId);
    },
  );

  app.get(
    '/ci/runs',
    { schema: { querystring: CiRunsQuery, response: { 200: z.object({ runs: z.array(CiRun) }) } } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return { runs: await runs.list(workspaceId, req.query) };
    },
  );

  app.post(
    '/ci/runs/refresh',
    { schema: { response: { 200: CiRunsRefreshResult } }, config: { rateLimit: RATE_LIMIT.refresh } },
    async (req) => {
      const { workspaceId } = await getContext(c, req);
      return runs.refresh(workspaceId);
    },
  );
}
