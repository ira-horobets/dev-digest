/** Runs the agent through the shared engine (no repo-intel, specs, intent, callers). */
import { reviewPullRequest, type ReviewOutcome } from '@devdigest/reviewer-core';
import type { LLMProvider, UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../server/src/adapters/git/diff-parser.js';
import type { LoadedAgent } from './manifest.js';

export interface ReviewRun {
  outcome: ReviewOutcome;
  diff: UnifiedDiff;
  durationMs: number;
}

export async function runReview(input: {
  agent: LoadedAgent;
  llm: LLMProvider;
  diffRaw: string;
  prNumber: number;
  prTitle: string;
  prBody: string;
}): Promise<ReviewRun> {
  const diff = parseUnifiedDiff(input.diffRaw);
  const started = Date.now();
  const { manifest } = input.agent;
  const outcome = await reviewPullRequest({
    systemPrompt: manifest.system_prompt,
    model: manifest.model,
    diff,
    llm: input.llm,
    strategy: manifest.strategy,
    skills: input.agent.skills,
    memory: input.agent.memory,
    prDescription: input.prBody,
    task: `Review PR #${input.prNumber}: ${input.prTitle}`,
  });
  return { outcome, diff, durationMs: Date.now() - started };
}
