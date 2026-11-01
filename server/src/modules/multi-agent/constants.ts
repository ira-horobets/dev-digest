/** multi-agent — tunables (ring 2). */

/** Agent runs of one multi-agent run that execute at the same time. */
export const MULTI_AGENT_CONCURRENCY = 3;
/** Selection bounds for POST /pulls/:id/multi-agent-run. */
export const MIN_AGENTS = 2;
export const MAX_AGENTS = 8;
/** Findings of different agents on one file whose starts are this close share a location. */
export const LINE_TOLERANCE = 3;
/** Completed `review` runs per agent that feed its estimate. */
export const ESTIMATE_SAMPLE = 10;
/** Same per-route limit as POST /pulls/:id/review: each call fans out to LLM runs. */
export const RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
