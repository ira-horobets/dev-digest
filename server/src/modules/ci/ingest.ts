/**
 * ci — run ingest (ring 2). Reads workflow runs and the `devdigest-result`
 * artifact through the GitHub API for recorded installations only; there is no
 * route that accepts a pushed result. Holds the per-workspace rate-limit gate.
 */
import type { CiRun, CiRunsQuery, CiRunsRefreshResult } from '@devdigest/shared';
import { ARTIFACT_MAX_BYTES, ARTIFACT_NAME, RUNS_PER_REFRESH, WORKFLOW_FILE } from './constants.js';
import {
  mapGitHubError,
  parseArtifact,
  rateLimitWaitMs,
  toCiRun,
  toRunRows,
  type ArtifactResult,
} from './helpers.js';
import type { CiDeps } from './ports.js';

const RANGE_MS: Record<CiRunsQuery['range'], number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};

export class CiRunsService {
  /** workspace → no GitHub calls before this instant. */
  private readonly blockedUntil = new Map<string, Date>();

  constructor(private readonly deps: CiDeps) {}

  /** Stored rows only; never calls GitHub (stored rows stay visible while rate-limited). */
  async list(ws: string, query: CiRunsQuery): Promise<CiRun[]> {
    const since = new Date(this.deps.now().getTime() - RANGE_MS[query.range]);
    const rows = await this.deps.repo.listCiRuns(ws, {
      since,
      agentId: query.agent_id,
      repo: query.repo,
      status: query.status,
    });
    return rows.map(toCiRun);
  }

  async refresh(ws: string): Promise<CiRunsRefreshResult> {
    const now = this.deps.now();
    const blocked = this.blockedUntil.get(ws);
    if (blocked && blocked > now) {
      return { ingested: 0, running: [], retry_at: blocked.toISOString(), errors: [] };
    }
    this.blockedUntil.delete(ws);
    const installations = (await this.deps.repo.listWorkspaceInstallations(ws)).filter(
      (i) => i.targetType === 'gha',
    );
    const result: CiRunsRefreshResult = { ingested: 0, running: [], retry_at: null, errors: [] };
    if (installations.length === 0) return result;
    if (!(await this.deps.hasGithubToken())) {
      result.errors.push({ repo: '*', message: 'The studio has no GitHub token' });
      return result;
    }
    const github = await this.deps.github();
    const stored = new Set(
      (await this.deps.repo.storedRunKeys(ws, installations.map((i) => i.id))).map(
        (k) => `${k.installationId}:${k.githubRunId}:${k.runAttempt}`,
      ),
    );
    for (const inst of installations) {
      const [owner = '', name = ''] = inst.repo.split('/');
      const ref = { owner, name };
      try {
        const runs = await github.listWorkflowRuns(ref, WORKFLOW_FILE, RUNS_PER_REFRESH);
        for (const run of runs) {
          if (run.status !== 'completed') {
            result.running.push({
              id: `running-${inst.id}-${run.id}-${run.run_attempt}`,
              ci_installation_id: inst.id,
              agent_id: inst.agentId,
              repo: inst.repo,
              pr_number: run.pr_numbers[0] ?? null,
              ran_at: run.created_at,
              status: 'running',
              findings_count: null,
              cost_usd: null,
              github_url: run.html_url,
              github_run_id: run.id,
              run_attempt: run.run_attempt,
              source: 'ci',
            });
            continue;
          }
          if (stored.has(`${inst.id}:${run.id}:${run.run_attempt}`)) continue;
          let artifact: ArtifactResult;
          const bytes = await github.downloadArtifact(ref, run.id, ARTIFACT_NAME, ARTIFACT_MAX_BYTES);
          if (bytes === null) artifact = { ok: false, error: 'The run produced no result artifact' };
          else if (bytes === 'too_large') artifact = { ok: false, error: 'The result artifact is larger than 1 MB' };
          else artifact = parseArtifact(bytes);
          const rows = toRunRows(inst, run, artifact);
          if (await this.deps.repo.insertCiRun(ws, rows)) result.ingested += 1;
        }
      } catch (err) {
        const wait = rateLimitWaitMs(err);
        if (wait !== null) {
          const until = new Date(this.deps.now().getTime() + wait);
          this.blockedUntil.set(ws, until);
          result.retry_at = until.toISOString();
          return result;
        }
        result.errors.push({ repo: inst.repo, message: mapGitHubError(err, 'read_runs').message });
      }
    }
    return result;
  }
}
