import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Template version stamped in the generated workflow and runner header. */
export const CI_TEMPLATE_VERSION = 'devdigest-ci/v1';

export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export type CiPostAs = z.infer<typeof CiPostAs>;

export const CiTrigger = z.enum(['opened', 'synchronize', 'reopened']);
export type CiTrigger = z.infer<typeof CiTrigger>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** Only "open_pr" is server-side; the zip option is built in the browser. */
  action: z.literal('open_pr').default('open_pr'),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTrigger).min(1).default(['opened', 'synchronize']),
  /** The user-edited workflow file; replaces the generated one when given. */
  workflow: z.string().max(65536).optional(),
  /** Required when a foreign workflow file exists at the same path. */
  confirm_overwrite: z.boolean().default(false),
  /** Required when the edited workflow contains key-like text (the user saw the warning). */
  confirm_secret_warning: z.boolean().default(false),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** Request body for `POST /agents/:id/ci/preview`. */
export const CiPreviewInput = z.object({
  repo: z.string().min(1),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTrigger).min(1).default(['opened', 'synchronize']),
});
export type CiPreviewInput = z.infer<typeof CiPreviewInput>;
export type CiPreviewInputBody = z.input<typeof CiPreviewInput>;

export const CiWorkflowState = z.enum(['absent', 'devdigest', 'foreign', 'unknown']);
export type CiWorkflowState = z.infer<typeof CiWorkflowState>;

export const CiPreview = z.object({
  files: z.array(CiFile),
  template_version: z.string(),
  memory: z.object({
    included: z.number().int(),
    /** Rows that may be exported (rows that look like secrets are excluded). */
    total: z.number().int(),
    /** Rows left out because their content looks like an API key. */
    dropped: z.number().int().default(0),
  }),
  /** True when the target repo is public (global memory would be published); null when unknown. */
  repo_public: z.boolean().nullable().default(null),
  workflow_state: CiWorkflowState,
  studio_token: z.boolean(),
});
export type CiPreview = z.infer<typeof CiPreview>;

export const CiPrState = z.enum(['open', 'merged', 'closed']);
export type CiPrState = z.infer<typeof CiPrState>;

export const CiInstallationEvent = z.object({
  id: z.string(),
  action: z.enum(['install', 'update']),
  at: z.string(),
  template_version: z.string().nullable(),
  outcome: z.enum(['succeeded', 'failed']),
  pr_url: z.string().nullable(),
  error: z.string().nullable(),
});
export type CiInstallationEvent = z.infer<typeof CiInstallationEvent>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  branch: z.string().default('devdigest/ci'),
  pr_url: z.string().nullable().default(null),
  pr_number: z.number().int().nullable().default(null),
  pr_state: CiPrState.nullable().default(null),
  pr_state_stale: z.boolean().default(false),
  workflow_version: z.string().nullable().default(null),
  post_as: CiPostAs.default('github_review'),
  triggers: z.array(CiTrigger).default(['opened', 'synchronize']),
  last_export_outcome: z.enum(['succeeded', 'failed']).nullable().default(null),
  last_export_at: z.string().nullable().default(null),
  out_of_date: z.boolean().default(false),
  events: z.array(CiInstallationEvent).default([]),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

export const CiInstallationsView = z.object({
  installations: z.array(CiInstallation),
  active_count: z.number().int(),
});
export type CiInstallationsView = z.infer<typeof CiInstallationsView>;

export const CiSecretState = z.enum(['ready', 'not_set', 'unknown']);
export type CiSecretState = z.infer<typeof CiSecretState>;

export const CiSecretStatus = z.object({
  name: z.string(),
  state: CiSecretState,
  reason: z.string().nullable(),
});
export type CiSecretStatus = z.infer<typeof CiSecretStatus>;

export const CiSecretsView = z.object({
  secrets: z.array(CiSecretStatus),
  studio_token: z.boolean(),
});
export type CiSecretsView = z.infer<typeof CiSecretsView>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiUpdateResult = z.object({
  installation: CiInstallation,
  pr_url: z.string().nullable(),
  error: z.string().nullable(),
});
export type CiUpdateResult = z.infer<typeof CiUpdateResult>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  agent_id: z.string().nullish(),
  repo: z.string().nullish(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: CiRunStatus.nullable(),
  verdict: Verdict.nullish(),
  findings_count: z.number().int().nullable(),
  blockers: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  github_url: z.string().nullable(),
  github_run_id: z.number().nullish(),
  run_attempt: z.number().int().nullish(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
  pr_link: z.object({ repo_id: z.string(), number: z.number().int() }).nullish(),
  error: z.string().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

export const CiRunsQuery = z.object({
  range: z.enum(['24h', '7d', '30d']).default('7d'),
  agent_id: z.string().optional(),
  repo: z.string().optional(),
  status: CiRunStatus.optional(),
});
export type CiRunsQuery = z.infer<typeof CiRunsQuery>;

export const CiRunsRefreshResult = z.object({
  ingested: z.number().int(),
  running: z.array(CiRun),
  retry_at: z.string().nullable(),
  errors: z.array(z.object({ repo: z.string(), message: z.string() })),
});
export type CiRunsRefreshResult = z.infer<typeof CiRunsRefreshResult>;

/**
 * The artifact shape uploaded by the CI runner (`devdigest-result.json`).
 * Untrusted input: every number is bounded (EC-14).
 */
const Count = z.number().int().nonnegative().max(10_000);
export const CiResultArtifact = z.object({
  findings_count: Count,
  critical: Count.nullish(),
  warning: Count.nullish(),
  suggestion: Count.nullish(),
  cost_usd: z.number().nonnegative().finite().max(1000).nullable(),
  duration_ms: z.number().int().nonnegative().max(86_400_000).nullish(),
  agent: z.string().max(200),
  version: z.string().max(100).nullish(),
  pr_number: z.number().int().nonnegative().max(100_000_000).nullish(),
  verdict: Verdict,
  blockers: Count,
  model: z.string().min(1).max(200),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
