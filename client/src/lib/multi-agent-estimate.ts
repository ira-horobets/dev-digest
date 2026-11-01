/* multi-agent-estimate — total time and cost for a selection of agents (pure). */
import type { AgentEstimate } from "@devdigest/shared";

export interface TotalEstimate {
  /** Makespan of the known durations over `cap` parallel slots; null when none is known. */
  durationMs: number | null;
  /** Sum of the known costs; null when none is known. */
  costUsd: number | null;
  /** True when any selected agent has no estimate for duration or cost. */
  partial: boolean;
}

/**
 * Total estimate for the selected agents. Agents run at most `cap` at a time:
 * the duration is a greedy schedule (longest first onto the least-loaded slot).
 * Cost is the sum of the known costs.
 */
export function totalEstimate(
  selectedIds: string[],
  estimates: AgentEstimate[] | undefined,
  cap: number,
): TotalEstimate {
  const byId = new Map((estimates ?? []).map((e) => [e.agent_id, e]));
  const picked = selectedIds.map((id) => byId.get(id));
  const durations = picked
    .map((e) => e?.duration_ms ?? null)
    .filter((d): d is number => d !== null)
    .sort((a, b) => b - a);
  const costs = picked.map((e) => e?.cost_usd ?? null).filter((c): c is number => c !== null);
  const slots = new Array<number>(Math.max(1, Math.min(cap, durations.length || 1))).fill(0);
  for (const d of durations) {
    let least = 0;
    for (let i = 1; i < slots.length; i++) if (slots[i]! < slots[least]!) least = i;
    slots[least]! += d;
  }
  return {
    durationMs: durations.length > 0 ? Math.max(...slots) : null,
    costUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    partial: picked.some((e) => !e || e.duration_ms == null || e.cost_usd == null),
  };
}
