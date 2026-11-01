import { z } from 'zod';
import { Severity } from './findings.js';
import { ReviewRunTarget } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRunRequest / MultiAgentRunStarted  POST /pulls/:id/multi-agent-run
 *   - MultiAgentRun        GET /pulls/:id/multi-agent and GET /multi-agent-runs/:id
 *   - AgentEstimates       GET /multi-agent/estimates
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  /** null when the agent was deleted after the run. */
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  /** Failure or cancel reason; null otherwise. */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  /** The agent's run in this multi-agent run (a column key). */
  run_id: z.string(),
  persona: z.string(),
  /**
   * Severity if the agent flagged it, 'ignored' when a completed agent did not,
   * 'no_result' when the agent failed, was cancelled or is still running.
   */
  verdict: z.union([Severity, z.literal('ignored'), z.literal('no_result')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  /** True when agents disagree (flagged vs silent, or divergent severities). */
  conflict: z.boolean(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Body of POST /pulls/:id/multi-agent-run. The 2..8 count rule lives in the service (400). */
export const MultiAgentRunRequest = z.object({ agent_ids: z.array(z.string()) });
export type MultiAgentRunRequest = z.infer<typeof MultiAgentRunRequest>;

/** Response of POST /pulls/:id/multi-agent-run: rows exist, model calls have not finished. */
export const MultiAgentRunStarted = z.object({
  multi_run_id: z.string(),
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
});
export type MultiAgentRunStarted = z.infer<typeof MultiAgentRunStarted>;

/** Response of GET /pulls/:id/multi-agent and GET /multi-agent-runs/:id. Status, totals, groups and conflicts are computed on read. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  status: z.enum(['running', 'done', 'failed']),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** One agent's run-time estimate over its last completed review runs. Nulls when it has none. */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  samples: z.number().int(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

/** Response of GET /multi-agent/estimates. `concurrency` is the server's cap for one multi-agent run. */
export const AgentEstimates = z.object({
  concurrency: z.number().int(),
  agents: z.array(AgentEstimate),
});
export type AgentEstimates = z.infer<typeof AgentEstimates>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
