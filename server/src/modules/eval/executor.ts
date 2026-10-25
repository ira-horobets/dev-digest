import type { LLMProvider, PromptAssembly } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { EVAL_TASK_LINE } from './constants.js';
import type { AgentRecord } from './ports.js';
import type { ScoredFinding } from './scoring.js';

/**
 * Runs ONE case through the SAME engine the live review path uses
 * (`reviewPullRequest` in @devdigest/reviewer-core), minus every slot that
 * needs a persisted PR or a checkout: no repo-intel (callers / repo map /
 * rank note), no intent, no memory. The inputs are therefore fixed by the
 * case alone, which is what makes two runs of different agent versions
 * comparable.
 */

export interface EvalCaseForExecution {
  inputDiff: string;
  inputMeta: { pr_number: number | null; title: string; body: string | null };
}

export interface EvalCaseExecutionResult {
  /** Findings KEPT by the citation gate — never the raw model output. */
  findings: ScoredFinding[];
  groundingKept: number;
  groundingTotal: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  durationMs: number;
  assembly: PromptAssembly;
}

export class EvalExecutor {
  async runCase(
    agent: Pick<AgentRecord, 'systemPrompt' | 'model' | 'strategy'>,
    llm: LLMProvider,
    evalCase: EvalCaseForExecution,
  ): Promise<EvalCaseExecutionResult> {
    const started = Date.now();
    const diff = parseUnifiedDiff(evalCase.inputDiff);

    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy ?? 'single-pass',
      ...(evalCase.inputMeta.body ? { prDescription: evalCase.inputMeta.body } : {}),
      task: `${EVAL_TASK_LINE} Frozen case title: "${evalCase.inputMeta.title}".`,
    });

    // kept = what survived grounding; total = kept + dropped.
    const groundingKept = outcome.review.findings.length;
    const groundingTotal = groundingKept + outcome.dropped.length;

    return {
      findings: outcome.review.findings,
      groundingKept,
      groundingTotal,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      costUsd: outcome.costUsd,
      durationMs: Date.now() - started,
      assembly: outcome.assembly,
    };
  }
}
