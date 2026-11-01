/** Gate, posting payload and the `devdigest-result.json` artifact. */
import { countBlockers, gateTriggered, toReviewPayload } from '@devdigest/reviewer-core';
import {
  CI_TEMPLATE_VERSION,
  CiResultArtifact,
  type Review,
  type UnifiedDiff,
  type AgentManifest,
} from '@devdigest/shared';

export interface RunResult {
  gate: boolean;
  exitCode: 0 | 1;
  /** Review event: only REQUEST_CHANGES (gate tripped) or COMMENT, never APPROVE. */
  event: 'REQUEST_CHANGES' | 'COMMENT';
  body: string;
  comments?: { path: string; line: number; body: string }[];
  artifact: CiResultArtifact;
}

export function buildResult(input: {
  review: Review;
  manifest: AgentManifest;
  diff: UnifiedDiff;
  costUsd: number | null;
  durationMs: number;
  prNumber: number;
}): RunResult {
  const { review, manifest } = input;
  const findings = review.findings;
  const gate = gateTriggered(findings, manifest.ci_fail_on);
  const payload = toReviewPayload(review, { failOn: manifest.ci_fail_on, diff: input.diff });
  const event = gate ? 'REQUEST_CHANGES' : 'COMMENT';
  // The engine says APPROVE on zero findings; CI posts COMMENT instead, so drop the "Approved" heading.
  const body = payload.event === 'APPROVE' && !gate ? payload.body.replace(' — Approved ✅', '') : payload.body;
  const count = (sev: string) => findings.filter((f) => f.severity === sev).length;
  const artifact = CiResultArtifact.parse({
    findings_count: findings.length,
    critical: count('CRITICAL'),
    warning: count('WARNING'),
    suggestion: count('SUGGESTION'),
    cost_usd: input.costUsd,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    agent: manifest.name.slice(0, 200),
    version: CI_TEMPLATE_VERSION,
    pr_number: input.prNumber,
    verdict: gate ? 'request_changes' : findings.length === 0 ? 'approve' : 'comment',
    blockers: countBlockers(findings, manifest.ci_fail_on),
    model: manifest.model,
  });
  return {
    gate,
    exitCode: gate ? 1 : 0,
    event,
    body,
    comments: payload.comments,
    artifact,
  };
}
