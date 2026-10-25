import type { EvalCallout, EvalMetricKey, EvalRun } from '@devdigest/shared';
import { caseTransitions } from './scoring.js';

const METRICS: EvalMetricKey[] = ['recall', 'precision', 'citation_accuracy'];

/**
 * The detail page's "what moved" banner — DERIVED from the two latest
 * completed suite runs, never narrated by a model. Picks the metric with the
 * largest absolute move; the causal clause (named case transitions) is only
 * present when the run data actually shows a flipped case.
 *
 * Returns null when there is nothing to compare (fewer than two runs, or
 * every metric is `null` on one side).
 */
export function buildCallout(
  latest: { metrics: EvalRun; agentVersion: number | null },
  previous: { metrics: EvalRun },
): EvalCallout | null {
  let best: { metric: EvalMetricKey; delta: number } | null = null;
  for (const metric of METRICS) {
    const a = previous.metrics[metric];
    const b = latest.metrics[metric];
    if (a == null || b == null) continue;
    const delta = b - a;
    if (best === null || Math.abs(delta) > Math.abs(best.delta)) best = { metric, delta };
  }
  if (best === null) return null;

  return {
    metric: best.metric,
    direction: best.delta >= 0 ? 'up' : 'down',
    magnitude: Math.abs(best.delta),
    agent_version: latest.agentVersion,
    case_transitions: caseTransitions(previous.metrics, latest.metrics),
  };
}
