/**
 * ci — pure helpers (ring 2): slugs, hashes, YAML and secret checks, GitHub
 * error mapping, artifact parsing and the row/DTO mappers. No I/O.
 */
import { createHash } from 'node:crypto';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { parse as parseYaml } from 'yaml';
import {
  CI_TEMPLATE_VERSION,
  CiResultArtifact,
  type CiFile,
  type CiInstallation,
  type CiRun,
  type CiInstallationEvent,
  type GitHubApiError,
  type WorkflowRunInfo,
} from '@devdigest/shared';
import { MAX_NAME_CHARS } from '../_shared/skill-limits.js';
import {
  ARTIFACT_FILE,
  ARTIFACT_MAX_BYTES,
  DEFAULT_RETRY_MS,
  PERMISSION_TABLE,
  WORKFLOW_HEADER_MARKER,
  type CiOperation,
} from './constants.js';
import type {
  AgentRunInsert,
  CiRunInsert,
  CiRunRecord,
  InstallationEventRecord,
  InstallationRecord,
} from './ports.js';

// ---------------------------------------------------------------- slugs

/** `Test Quality  Gate!` → `test-quality-gate` (same algorithm as the skills module). */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_CHARS)
    .replace(/-+$/g, '');
}

/** Slugs for `names` in order; collisions (and empty slugs) get `-2`, `-3`, … suffixes. */
export function uniqueSlugs(names: string[], fallback = 'skill'): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = slugify(name) || fallback;
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    return slug;
  });
}

// ---------------------------------------------------------------- hashing

/** sha256 over the non-editable files' path + contents and the template version. */
export function configHash(files: CiFile[]): string {
  const h = createHash('sha256');
  h.update(CI_TEMPLATE_VERSION);
  for (const f of files.filter((x) => !x.editable)) {
    h.update('\0');
    h.update(f.path);
    h.update('\0');
    h.update(f.contents);
  }
  return h.digest('hex');
}

// ---------------------------------------------------------------- workflow checks

export function hasDevdigestHeader(text: string): boolean {
  const head = text.split('\n').slice(0, 5).join('\n');
  return head.includes(WORKFLOW_HEADER_MARKER);
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /(?:key|token|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9+/_-]{32,}/i,
];

/** Does `text` look like it contains an API key / token? */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export type YamlCheck = { ok: true } | { ok: false; error: string };

export function validateWorkflowYaml(text: string): YamlCheck {
  try {
    const doc = parseYaml(text);
    if (doc === null || typeof doc !== 'object') {
      return { ok: false, error: 'The workflow must be a YAML mapping' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split('\n')[0]! : 'Invalid YAML' };
  }
}

// ---------------------------------------------------------------- GitHub errors

export interface MappedGitHubError {
  status: number;
  message: string;
  missingPermission: string | null;
}

const asApiError = (err: unknown): GitHubApiError | null => {
  const e = err as Partial<GitHubApiError> | null;
  return e && typeof e.status === 'number' && typeof e.message === 'string'
    ? (e as GitHubApiError)
    : null;
};

/** `contents=write` → `Contents: write`. */
const phrasePermission = (pair: string): string => {
  const [name = '', level = ''] = pair.split('=');
  const label = name.replace(/_/g, ' ');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${level}`;
};

/**
 * Turn a GitHub failure into a user message plus, when it can be derived, the
 * token permission that is missing (D5). A bare 404 never names a permission.
 */
export function mapGitHubError(err: unknown, operation: CiOperation): MappedGitHubError {
  const e = asApiError(err);
  if (!e) return { status: 502, message: 'GitHub request failed', missingPermission: null };
  if (e.status === 404) {
    return {
      status: 404,
      message: `${e.message} — repository or branch not found, or the token cannot see it`,
      missingPermission: null,
    };
  }
  let missing: string | null = null;
  if (e.status === 403 || e.status === 401) {
    const alt = e.acceptedPermissions?.[0];
    if (e.tokenKind === 'fine_grained' && alt && alt.length > 0) {
      missing = alt.map(phrasePermission).join(' + ');
    } else if (e.tokenKind === 'classic') {
      const have = new Set(e.oauthScopes ?? []);
      const need = (e.acceptedOauthScopes ?? []).filter((s) => !have.has(s));
      if (need.length > 0) missing = need.map((s) => `\`${s}\` scope`).join(' + ');
    }
    if (!missing && e.retryAfterMs === undefined) {
      const row = PERMISSION_TABLE[operation];
      missing = e.tokenKind === 'classic' ? row.classic : row.fine_grained;
    }
  }
  return { status: e.status, message: e.message, missingPermission: missing };
}

/** Milliseconds to wait when GitHub rate-limited the call, else null. */
export function rateLimitWaitMs(err: unknown): number | null {
  const e = asApiError(err);
  if (!e) return null;
  if (e.status === 429) return e.retryAfterMs ?? DEFAULT_RETRY_MS;
  if (e.status === 403 && e.retryAfterMs !== undefined) return e.retryAfterMs;
  return null;
}

// ---------------------------------------------------------------- runs

export type CiRunStatusValue = 'succeeded' | 'failed' | 'no_findings';

export function ciRunStatus(conclusion: string | null, findingsCount: number | null): CiRunStatusValue {
  if (conclusion !== 'success') return 'failed';
  return findingsCount === 0 ? 'no_findings' : 'succeeded';
}

export type ArtifactResult =
  | { ok: true; artifact: CiResultArtifact }
  | { ok: false; error: string };

/**
 * Untrusted artifact zip → validated result. The zip header's size fields are
 * attacker-controlled, so the inflated bytes are counted as they are produced
 * and inflation is aborted past 1 MB (a zip bomb becomes a failed row).
 */
export function parseArtifact(bytes: Uint8Array): ArtifactResult {
  let matches = 0;
  let oversize = false;
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    const unzip = new Unzip((file) => {
      if (file.name !== ARTIFACT_FILE) return; // never started: never inflated
      matches += 1;
      if (matches > 1) return;
      file.ondata = (err, chunk) => {
        if (err || oversize) return;
        total += chunk.length;
        if (total > ARTIFACT_MAX_BYTES) {
          oversize = true;
          file.terminate();
          return;
        }
        chunks.push(chunk);
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    unzip.push(bytes, true);
  } catch {
    if (!oversize) return { ok: false, error: 'The result artifact is not a valid zip file' };
  }
  if (oversize) return { ok: false, error: 'The result artifact is larger than 1 MB' };
  if (matches !== 1 || chunks.length === 0) {
    return { ok: false, error: `The artifact does not contain exactly one ${ARTIFACT_FILE}` };
  }
  const data = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    data.set(c, off);
    off += c.length;
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return { ok: false, error: `${ARTIFACT_FILE} is not valid JSON` };
  }
  const parsed = CiResultArtifact.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `${ARTIFACT_FILE} is invalid: ${issue ? `${issue.path.join('.') || 'root'} ${issue.message}` : 'schema mismatch'}`,
    };
  }
  return { ok: true, artifact: parsed.data };
}

const MAX_ERROR_CHARS = 500;

/**
 * Build the `ci_runs` + `agent_runs` values of one completed workflow run.
 * Job URL from the API response; `agent_runs.pr_id` is never set; status is
 * `done`/`failed`, never `running`.
 */
export function toRunRows(
  installation: { id: string; agentId: string },
  run: WorkflowRunInfo,
  result: ArtifactResult,
): { ci: CiRunInsert; agentRun: AgentRunInsert } {
  const ranAt = new Date(run.created_at);
  const started = run.run_started_at ? Date.parse(run.run_started_at) : NaN;
  const ended = Date.parse(run.updated_at);
  const ciDuration =
    Number.isFinite(started) && Number.isFinite(ended) && ended >= started
      ? Math.min(ended - started, 86_400_000)
      : null;
  const art = result.ok ? result.artifact : null;
  const error = result.ok ? null : result.error.slice(0, MAX_ERROR_CHARS);
  const prNumber = run.pr_numbers[0] ?? art?.pr_number ?? null;
  const ci: CiRunInsert = {
    ciInstallationId: installation.id,
    prNumber,
    ranAt,
    status: art ? ciRunStatus(run.conclusion, art.findings_count) : 'failed',
    findingsCount: art ? art.findings_count : null,
    costUsd: art ? art.cost_usd : null,
    githubUrl: run.html_url,
    githubRunId: run.id,
    runAttempt: run.run_attempt,
    verdict: art ? art.verdict : null,
    durationMs: ciDuration,
    error,
    blockers: art ? art.blockers : null,
  };
  const agentRun: AgentRunInsert = {
    agentId: installation.agentId,
    ranAt,
    provider: 'openrouter',
    model: art ? art.model : null,
    durationMs: art?.duration_ms ?? null,
    costUsd: art ? art.cost_usd : null,
    status: art ? 'done' : 'failed',
    error,
    findingsCount: art ? art.findings_count : null,
    blockers: art ? art.blockers : null,
  };
  return { ci, agentRun };
}

// ---------------------------------------------------------------- mappers

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toEvent(e: InstallationEventRecord): CiInstallationEvent {
  return {
    id: e.id,
    action: e.action,
    at: e.at.toISOString(),
    template_version: e.templateVersion,
    outcome: e.outcome,
    pr_url: e.prUrl,
    error: e.error,
  };
}

export function toCiInstallation(
  r: InstallationRecord,
  extra: { outOfDate: boolean; prStateStale: boolean },
): CiInstallation {
  const last = r.events[0] ?? null;
  return {
    id: r.id,
    agent_id: r.agentId,
    repo: r.repo,
    target_type: r.targetType,
    installed_at: r.installedAt.toISOString(),
    branch: r.branch,
    pr_url: r.prUrl,
    pr_number: r.prNumber,
    pr_state: r.prState,
    pr_state_stale: extra.prStateStale,
    workflow_version: r.workflowVersion,
    post_as: r.postAs,
    triggers: r.triggers.filter(
      (t): t is 'opened' | 'synchronize' | 'reopened' =>
        t === 'opened' || t === 'synchronize' || t === 'reopened',
    ),
    last_export_outcome: last ? last.outcome : null,
    last_export_at: last ? last.at.toISOString() : null,
    out_of_date: extra.outOfDate,
    events: r.events.map(toEvent),
  };
}

export function toCiRun(r: CiRunRecord): CiRun {
  const status =
    r.status === 'succeeded' || r.status === 'failed' || r.status === 'no_findings' ? r.status : null;
  const verdict =
    r.verdict === 'approve' || r.verdict === 'comment' || r.verdict === 'request_changes'
      ? r.verdict
      : null;
  return {
    id: r.id,
    ci_installation_id: r.ciInstallationId,
    agent_id: r.agentId,
    repo: r.repo,
    pr_number: r.prNumber,
    ran_at: iso(r.ranAt),
    status,
    verdict,
    findings_count: r.findingsCount,
    blockers: r.blockers,
    cost_usd: r.costUsd,
    duration_ms: r.durationMs,
    github_url: r.githubUrl,
    github_run_id: r.githubRunId,
    run_attempt: r.runAttempt,
    source: 'ci',
    agent: r.agentName,
    duration_s: r.durationMs == null ? null : Math.round(r.durationMs / 100) / 10,
    pr_link: r.prLink ? { repo_id: r.prLink.repoId, number: r.prLink.number } : null,
    error: r.error,
  };
}
