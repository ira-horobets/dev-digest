/** Orchestration: env → agent → PR + diff → review → artifact → post → exit code. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import type { LLMProvider } from '@devdigest/shared';
import { loadEnv, RunnerError } from './env.js';
import { GitHubApi, GitHubHttpError } from './github.js';
import { loadAgent } from './manifest.js';
import { runReview } from './review.js';
import { buildResult, type RunResult } from './result.js';

export const ARTIFACT_FILE = 'devdigest-result.json';
const REVIEW_HINT =
  "Actions may be blocked from reviewing PRs: Settings → Actions → General → Workflow permissions";

export interface MainDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  fetchImpl?: typeof fetch;
  /** Test seam; production builds an OpenRouter provider from the key. */
  llm?: LLMProvider;
  log?: (line: string) => void;
}

const rejected = (err: unknown): boolean =>
  err instanceof GitHubHttpError && (err.status === 403 || err.status === 422);

/** Post per mode (AC-47) with the D12 fallback; the exit code is never affected. */
async function post(api: GitHubApi, mode: string, n: number, r: RunResult, log: (l: string) => void) {
  if (mode === 'none') return;
  try {
    if (mode === 'pr_comment') {
      await api.postComment(n, r.body);
      return;
    }
    try {
      await api.postReview(n, r.body, r.event, r.comments);
      return;
    } catch (err) {
      if (!rejected(err)) throw err;
    }
    log(REVIEW_HINT);
    // Retry once as a COMMENT review (only different when the first one asked for changes).
    if (r.event === 'REQUEST_CHANGES') {
      try {
        await api.postReview(n, r.body, 'COMMENT', r.comments);
        return;
      } catch (err) {
        if (!rejected(err)) throw err;
      }
    }
    await api.postComment(n, r.body);
  } catch (err) {
    // The artifact is written already: report and keep the gate exit code.
    log(`Could not post the result to GitHub: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

/** Returns the process exit code: 0 or 1 (the gate) after a completed review, 2 before. */
export async function main(deps: MainDeps): Promise<number> {
  const log = deps.log ?? ((l: string) => console.error(l));
  try {
    const env = loadEnv(deps.env);
    const agent = await loadAgent(env.agentPath, deps.cwd);
    let prNumber: number;
    try {
      const event = JSON.parse(await readFile(env.eventPath, 'utf8')) as { pull_request?: { number?: number } };
      const n = event.pull_request?.number;
      if (!Number.isInteger(n) || (n as number) <= 0) throw new Error('no pull request');
      prNumber = n as number;
    } catch {
      throw new RunnerError('This workflow run is not for a pull request');
    }
    const api = new GitHubApi({
      token: env.githubToken,
      apiUrl: env.apiUrl,
      repository: env.repository,
      fetchImpl: deps.fetchImpl,
    });
    const [pull, diffRaw] = await Promise.all([api.getPull(prNumber), api.getDiff(prNumber)]);
    const llm = deps.llm ?? new OpenRouterProvider(env.openrouterKey);
    const run = await runReview({
      agent,
      llm,
      diffRaw,
      prNumber,
      prTitle: pull.title,
      prBody: pull.body,
    });
    const result = buildResult({
      review: run.outcome.review,
      manifest: agent.manifest,
      diff: run.diff,
      costUsd: run.outcome.costUsd,
      durationMs: run.durationMs,
      prNumber,
    });
    await writeFile(path.join(deps.cwd, ARTIFACT_FILE), `${JSON.stringify(result.artifact)}\n`, 'utf8');
    await post(api, env.postAs, prNumber, result, log);
    return result.exitCode;
  } catch (err) {
    const message =
      err instanceof RunnerError
        ? err.message
        : err instanceof GitHubHttpError
          ? `GitHub request failed (${err.status}): ${err.message}`
          : `Review failed: ${err instanceof Error ? err.message : 'unknown error'}`;
    log(message);
    return 2;
  }
}
