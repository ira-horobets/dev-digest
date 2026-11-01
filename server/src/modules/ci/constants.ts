/** ci — constants (ring 2). */

export const CI_BRANCH = 'devdigest/ci';
export const WORKFLOW_FILE = 'devdigest-review.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;
export const RUNNER_PATH = '.devdigest/runner/index.js';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const ARTIFACT_NAME = 'devdigest-result';
export const ARTIFACT_FILE = 'devdigest-result.json';

export const PR_TITLE_INSTALL = 'Add DevDigest CI review';
export const PR_TITLE_UPDATE = 'Update DevDigest CI config';

export const MEMORY_MAX_ITEMS = 200;
export const MEMORY_MAX_BYTES = 100 * 1024;
export const ARTIFACT_MAX_BYTES = 1024 * 1024;
export const RUNS_PER_REFRESH = 50;
export const CI_RUNS_LIMIT = 200;

/** Marker the workflow and runner headers carry (`devdigest-ci/v1`). */
export const WORKFLOW_HEADER_MARKER = 'devdigest-ci/';

/** Preview must stay fast (NFR-1): the workflow-state probe gives up after this. */
export const PREVIEW_GITHUB_TIMEOUT_MS = 1500;

export const NODE_VERSION = '22';

/** Fallback wait when GitHub rate-limits without saying for how long. */
export const DEFAULT_RETRY_MS = 60_000;

export const OPENROUTER_SECRET = 'OPENROUTER_API_KEY';
export const GITHUB_SECRET = 'GITHUB_TOKEN';

export const RATE_LIMIT = {
  export: { max: 10, timeWindow: '1 minute' },
  update: { max: 10, timeWindow: '1 minute' },
  refresh: { max: 12, timeWindow: '1 minute' },
} as const;

/** Body cap of the export route (the edited workflow is at most 64 KB). */
export const EXPORT_BODY_LIMIT = 128 * 1024;

export type CiOperation = 'write_files' | 'open_pr' | 'list_secrets' | 'read_runs';

/** Least permission each GitHub operation needs, per token kind (D5 fallback). */
export const PERMISSION_TABLE: Record<CiOperation, { fine_grained: string; classic: string }> = {
  write_files: { fine_grained: 'Contents: write + Workflows: write', classic: '`repo` + `workflow` scope' },
  open_pr: { fine_grained: 'Pull requests: write', classic: '`repo` scope' },
  list_secrets: { fine_grained: 'Secrets: read', classic: '`repo` scope' },
  read_runs: { fine_grained: 'Actions: read', classic: '`repo` scope' },
};
