/**
 * ci — export / update / installations service (ring 2). Takes ports only; the
 * GitHub token is never read here, only `deps.github()`. No model call (NFR-2).
 */
import {
  CI_TEMPLATE_VERSION,
  type CiExport,
  type CiExportInput,
  type CiInstallation,
  type CiInstallationsView,
  type CiPreview,
  type CiPreviewInput,
  type CiSecretStatus,
  type CiSecretsView,
  type CiUpdateResult,
  type CiWorkflowState,
  type CiFile,
} from '@devdigest/shared';
import {
  ConfigError,
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import {
  CI_BRANCH,
  GITHUB_SECRET,
  OPENROUTER_SECRET,
  PR_TITLE_INSTALL,
  PR_TITLE_UPDATE,
  PREVIEW_GITHUB_TIMEOUT_MS,
  WORKFLOW_PATH,
  type CiOperation,
} from './constants.js';
import { buildFiles } from './generate.js';
import {
  configHash,
  hasDevdigestHeader,
  looksLikeSecret,
  mapGitHubError,
  rateLimitWaitMs,
  toCiInstallation,
  validateWorkflowYaml,
} from './helpers.js';
import type { CiDeps, CiGitHubPort, ExportAgent, ImportedRepo, InstallationRecord } from './ports.js';

const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

type PostAs = CiExportInput['post_as'];
type Triggers = CiExportInput['triggers'];

const refOf = (fullName: string) => {
  const [owner = '', name = ''] = fullName.split('/');
  return { owner, name };
};

const withDeadline = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });

export class CiService {
  constructor(private readonly deps: CiDeps) {}

  // ------------------------------------------------------------ shared steps

  private async loadAgent(ws: string, agentId: string): Promise<ExportAgent> {
    const agent = await this.deps.repo.getExportAgent(ws, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private requireOpenRouter(agent: ExportAgent): void {
    if (agent.provider !== 'openrouter') {
      throw new ValidationError(
        `CI supports OpenRouter only; this agent uses ${agent.provider}. Switch the agent's provider to OpenRouter first.`,
      );
    }
  }

  private async loadRepo(ws: string, fullName: string): Promise<ImportedRepo> {
    if (!REPO_RE.test(fullName)) throw new ValidationError('Repository must be "owner/name"');
    const repo = await this.deps.repo.findRepoByFullName(ws, fullName);
    if (!repo) throw new NotFoundError('Repository is not imported');
    return repo;
  }

  private async generate(
    ws: string,
    agent: ExportAgent,
    repoFullName: string,
    postAs: PostAs,
    triggers: Triggers,
  ) {
    const imported = await this.deps.repo.findRepoByFullName(ws, repoFullName);
    const memoryRows = await this.deps.repo.listMemoryForExport(ws, imported?.id ?? null);
    const runnerBundle = await this.deps.runnerBundle();
    return buildFiles({ agent, memoryRows, runnerBundle, postAs, triggers });
  }

  private async gh<T>(operation: CiOperation, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const mapped = mapGitHubError(err, operation);
      throw new ExternalServiceError(
        mapped.missingPermission && mapped.status !== 404
          ? `${mapped.message} (missing token permission: ${mapped.missingPermission})`
          : mapped.message,
        { status: mapped.status, missing_permission: mapped.missingPermission },
      );
    }
  }

  private workflowState(existing: string | null): CiWorkflowState {
    if (existing === null) return 'absent';
    return hasDevdigestHeader(existing) ? 'devdigest' : 'foreign';
  }

  // ------------------------------------------------------------ preview / secrets

  async preview(ws: string, agentId: string, input: CiPreviewInput): Promise<CiPreview> {
    const agent = await this.loadAgent(ws, agentId);
    this.requireOpenRouter(agent);
    const repo = await this.loadRepo(ws, input.repo);
    const built = await this.generate(ws, agent, repo.fullName, input.post_as, input.triggers);
    const studioToken = await this.deps.hasGithubToken();
    let state: CiWorkflowState = 'unknown';
    let repoPublic: boolean | null = null;
    if (studioToken) {
      try {
        const probe = await withDeadline(
          (async () => {
            const github = await this.deps.github();
            const ref = refOf(repo.fullName);
            const [existing, info] = await Promise.all([
              github.getOptionalFileContent(ref, WORKFLOW_PATH, repo.defaultBranch),
              github.getRepoInfo(ref).catch(() => null),
            ]);
            return { existing, info };
          })(),
          PREVIEW_GITHUB_TIMEOUT_MS,
        );
        state = this.workflowState(probe.existing);
        repoPublic = typeof probe.info?.private === 'boolean' ? !probe.info.private : null;
      } catch {
        state = 'unknown';
      }
    }
    return {
      files: built.files,
      template_version: CI_TEMPLATE_VERSION,
      memory: built.memory,
      repo_public: repoPublic,
      workflow_state: state,
      studio_token: studioToken,
    };
  }

  async secrets(ws: string, agentId: string, repoFullName: string): Promise<CiSecretsView> {
    await this.loadAgent(ws, agentId);
    const repo = await this.loadRepo(ws, repoFullName);
    const studioToken = await this.deps.hasGithubToken();
    const ready: CiSecretStatus = { name: GITHUB_SECRET, state: 'ready', reason: null };
    const openrouter = (state: CiSecretStatus['state'], reason: string | null): CiSecretStatus => ({
      name: OPENROUTER_SECRET,
      state,
      reason,
    });
    if (!studioToken) {
      return {
        secrets: [ready, openrouter('unknown', 'The studio has no GitHub token to read secret names')],
        studio_token: false,
      };
    }
    try {
      const github = await this.deps.github();
      const found = await github.listActionsSecretNames(refOf(repo.fullName));
      if (found.repo.includes(OPENROUTER_SECRET) || found.org?.includes(OPENROUTER_SECRET)) {
        return { secrets: [ready, openrouter('ready', null)], studio_token: true };
      }
      if (found.org_unreadable) {
        return {
          secrets: [ready, openrouter('unknown', 'Organization secrets could not be read')],
          studio_token: true,
        };
      }
      if (found.has_environments) {
        return {
          secrets: [ready, openrouter('unknown', 'Environment secrets cannot be listed')],
          studio_token: true,
        };
      }
      return { secrets: [ready, openrouter('not_set', null)], studio_token: true };
    } catch (err) {
      const wait = rateLimitWaitMs(err);
      const mapped = mapGitHubError(err, 'list_secrets');
      const reason =
        wait !== null
          ? 'GitHub rate limit reached'
          : mapped.status === 403 || mapped.status === 404
            ? `The token cannot read Actions secrets${mapped.missingPermission ? ` (${mapped.missingPermission})` : ''}`
            : 'GitHub could not be reached';
      return { secrets: [ready, openrouter('unknown', reason)], studio_token: true };
    }
  }

  // ------------------------------------------------------------ export / update

  /**
   * One atomic commit to `devdigest/ci` from the live default branch, then reuse
   * the open PR or open a new one. Writes to no other branch.
   */
  private async pushToCiBranch(
    github: CiGitHubPort,
    repoFullName: string,
    files: CiFile[],
    opts: { title: string; message: string; body: string },
  ): Promise<{ url: string; number: number; defaultBranch: string }> {
    const ref = refOf(repoFullName);
    const info = await this.gh('write_files', () => github.getRepoInfo(ref));
    const base = info.default_branch;
    await this.gh('write_files', () =>
      github.commitFiles(ref, {
        branch: CI_BRANCH,
        base,
        message: opts.message,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      }),
    );
    let pr = await this.gh('open_pr', () => github.findOpenPr(ref, CI_BRANCH));
    if (!pr) {
      try {
        pr = await this.gh('open_pr', () =>
          github.openPullRequest(ref, {
            title: opts.title,
            head: CI_BRANCH,
            base,
            body: opts.body,
          }),
        );
      } catch (err) {
        // A concurrent export opened it first: reuse that PR (EC-2).
        const status = (err as { details?: { status?: number } }).details?.status;
        if (status !== 422) throw err;
        pr = await this.gh('open_pr', () => github.findOpenPr(ref, CI_BRANCH));
        if (!pr) throw err;
      }
    }
    return { url: pr.url, number: pr.number, defaultBranch: base };
  }

  private prBody(agent: ExportAgent, repo: string, update: boolean): string {
    return [
      update
        ? `Regenerates the DevDigest CI files for the agent "${agent.name}" in ${repo}.`
        : `Adds the DevDigest CI review for the agent "${agent.name}" to ${repo}.`,
      '',
      `Template version: ${CI_TEMPLATE_VERSION}`,
      'Add `OPENROUTER_API_KEY` to the repository Actions secrets before the workflow runs.',
    ].join('\n');
  }

  async exportCi(ws: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    if (!(await this.deps.hasGithubToken())) {
      throw new ConfigError('GITHUB_TOKEN is not configured');
    }
    const agent = await this.loadAgent(ws, agentId);
    this.requireOpenRouter(agent);
    const repo = await this.loadRepo(ws, input.repo);
    const built = await this.generate(ws, agent, repo.fullName, input.post_as, input.triggers);
    let files = built.files;
    if (input.workflow !== undefined) {
      const check = validateWorkflowYaml(input.workflow);
      if (!check.ok) throw new ValidationError(`The workflow is not valid YAML: ${check.error}`);
      if (looksLikeSecret(input.workflow) && !input.confirm_secret_warning) {
        throw new ValidationError(
          'The edited workflow contains text that looks like an API key; confirm to write it anyway',
          { code: 'secret_in_workflow' },
        );
      }
      files = files.map((f) => (f.path === WORKFLOW_PATH ? { ...f, contents: input.workflow! } : f));
    }
    const hash = configHash(built.files);
    const github = await this.deps.github();
    const ref = refOf(repo.fullName);
    const existing = (await this.deps.repo.listInstallations(ws, agentId)).find(
      (i) => i.repo === repo.fullName && i.targetType === 'gha',
    );
    try {
      const info = await this.gh('write_files', () => github.getRepoInfo(ref));
      const remote = await this.gh('write_files', () =>
        github.getOptionalFileContent(ref, WORKFLOW_PATH, info.default_branch),
      );
      if (this.workflowState(remote) === 'foreign' && !input.confirm_overwrite) {
        throw new ConflictError(
          `${WORKFLOW_PATH} already exists and is not a DevDigest workflow; confirm to overwrite it`,
        );
      }
      const pr = await this.pushToCiBranch(github, repo.fullName, files, {
        title: PR_TITLE_INSTALL,
        message: PR_TITLE_INSTALL,
        body: this.prBody(agent, repo.fullName, false),
      });
      const record = await this.deps.repo.upsertInstallation(ws, agentId, {
        repo: repo.fullName,
        configHash: hash,
        workflowVersion: CI_TEMPLATE_VERSION,
        postAs: input.post_as,
        triggers: input.triggers,
        prUrl: pr.url,
        prNumber: pr.number,
      });
      await this.deps.repo.insertEvent(ws, record.id, {
        action: 'install',
        templateVersion: CI_TEMPLATE_VERSION,
        configHash: hash,
        outcome: 'succeeded',
        prUrl: pr.url,
        error: null,
      });
      const fresh = (await this.deps.repo.getInstallation(ws, agentId, record.id)) ?? record;
      return {
        installation: toCiInstallation(fresh, { outOfDate: false, prStateStale: false }),
        files,
        pr_url: pr.url,
      };
    } catch (err) {
      // A failed export records no installation; an existing one gets a failed event.
      if (existing && err instanceof ExternalServiceError) {
        await this.deps.repo.insertEvent(ws, existing.id, {
          action: 'install',
          templateVersion: CI_TEMPLATE_VERSION,
          configHash: null,
          outcome: 'failed',
          prUrl: null,
          error: err.message.slice(0, 500),
        });
      }
      throw err;
    }
  }

  async update(ws: string, agentId: string, installationId: string): Promise<CiUpdateResult> {
    const record = await this.deps.repo.getInstallation(ws, agentId, installationId);
    if (!record) throw new NotFoundError('Installation not found');
    if (!(await this.deps.hasGithubToken())) {
      throw new ConfigError('GITHUB_TOKEN is not configured');
    }
    const agent = await this.loadAgent(ws, agentId);
    this.requireOpenRouter(agent);
    const built = await this.generate(ws, agent, record.repo, record.postAs, this.triggersOf(record));
    const hash = configHash(built.files);
    const github = await this.deps.github();
    try {
      const pr = await this.pushToCiBranch(github, record.repo, built.files, {
        title: PR_TITLE_UPDATE,
        message: PR_TITLE_UPDATE,
        body: this.prBody(agent, record.repo, true),
      });
      const saved = await this.deps.repo.upsertInstallation(ws, agentId, {
        repo: record.repo,
        configHash: hash,
        workflowVersion: CI_TEMPLATE_VERSION,
        postAs: record.postAs,
        triggers: record.triggers,
        prUrl: pr.url,
        prNumber: pr.number,
      });
      await this.deps.repo.insertEvent(ws, saved.id, {
        action: 'update',
        templateVersion: CI_TEMPLATE_VERSION,
        configHash: hash,
        outcome: 'succeeded',
        prUrl: pr.url,
        error: null,
      });
      const fresh = (await this.deps.repo.getInstallation(ws, agentId, saved.id)) ?? saved;
      return {
        installation: toCiInstallation(fresh, { outOfDate: false, prStateStale: false }),
        pr_url: pr.url,
        error: null,
      };
    } catch (err) {
      if (!(err instanceof ExternalServiceError)) throw err;
      const message = err.message.slice(0, 500);
      await this.deps.repo.insertEvent(ws, record.id, {
        action: 'update',
        templateVersion: CI_TEMPLATE_VERSION,
        configHash: null,
        outcome: 'failed',
        prUrl: null,
        error: message,
      });
      const fresh = (await this.deps.repo.getInstallation(ws, agentId, record.id)) ?? record;
      return {
        installation: toCiInstallation(fresh, { outOfDate: true, prStateStale: false }),
        pr_url: null,
        error: message,
      };
    }
  }

  private triggersOf(record: InstallationRecord): Triggers {
    const known = record.triggers.filter(
      (t): t is 'opened' | 'synchronize' | 'reopened' =>
        t === 'opened' || t === 'synchronize' || t === 'reopened',
    );
    return known.length > 0 ? known : ['opened', 'synchronize'];
  }

  // ------------------------------------------------------------ installations

  async installations(ws: string, agentId: string): Promise<CiInstallationsView> {
    const agent = await this.loadAgent(ws, agentId);
    const records = await this.deps.repo.listInstallations(ws, agentId);
    let github: CiGitHubPort | null = null;
    if (records.length > 0 && (await this.deps.hasGithubToken())) {
      try {
        github = await this.deps.github();
      } catch {
        github = null;
      }
    }
    const now = this.deps.now();
    const out: CiInstallation[] = await Promise.all(
      records.map(async (r) => {
        const built = await this.generate(ws, agent, r.repo, r.postAs, this.triggersOf(r));
        const outOfDate =
          r.workflowVersion !== CI_TEMPLATE_VERSION || r.configHash !== configHash(built.files);
        let state = r.prState;
        let stale = false;
        if (r.prNumber != null) {
          if (!github) stale = true;
          else {
            try {
              state = await github.getPullState(refOf(r.repo), r.prNumber);
              await this.deps.repo.updateInstallationPr(ws, r.id, { prState: state, checkedAt: now });
            } catch {
              stale = true;
            }
          }
        }
        return toCiInstallation({ ...r, prState: state }, { outOfDate, prStateStale: stale });
      }),
    );
    return {
      installations: out,
      active_count: out.filter((i) => i.pr_state === 'merged').length,
    };
  }
}
