/** Environment of the CI job: validated once; values are never logged. */
import { z } from 'zod';

export class RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerError';
  }
}

export const KEY_MISSING_MESSAGE =
  "OPENROUTER_API_KEY is not set (fork PRs get no secrets) — add it to the repo's Actions secrets";

const Env = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_REPOSITORY: z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/),
  GITHUB_EVENT_PATH: z.string().min(1),
  GITHUB_API_URL: z.string().url().default('https://api.github.com'),
  DEVDIGEST_AGENT: z.string().min(1),
  DEVDIGEST_POST_AS: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
});

export interface RunnerEnv {
  openrouterKey: string;
  githubToken: string;
  repository: string;
  eventPath: string;
  apiUrl: string;
  agentPath: string;
  postAs: 'github_review' | 'pr_comment' | 'none';
}

export function loadEnv(env: Record<string, string | undefined>): RunnerEnv {
  // Checked first so a fork PR gets the specific, actionable message (AC-51).
  if (!env.OPENROUTER_API_KEY) throw new RunnerError(KEY_MISSING_MESSAGE);
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Names only: never echo a value.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(', ');
    throw new RunnerError(`Missing or invalid environment: ${names}`);
  }
  const e = parsed.data;
  return {
    openrouterKey: e.OPENROUTER_API_KEY,
    githubToken: e.GITHUB_TOKEN,
    repository: e.GITHUB_REPOSITORY,
    eventPath: e.GITHUB_EVENT_PATH,
    apiUrl: e.GITHUB_API_URL.replace(/\/+$/, ''),
    agentPath: e.DEVDIGEST_AGENT,
    postAs: e.DEVDIGEST_POST_AS,
  };
}
