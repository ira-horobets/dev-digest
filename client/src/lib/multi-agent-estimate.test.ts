import { describe, expect, it } from "vitest";
import type { AgentEstimate } from "@devdigest/shared";
import { totalEstimate } from "./multi-agent-estimate";

const est = (id: string, duration_ms: number | null, cost_usd: number | null): AgentEstimate => ({
  agent_id: id,
  duration_ms,
  cost_usd,
  samples: duration_ms == null ? 0 : 3,
});

describe("totalEstimate", () => {
  it("up to the cap: the longest duration, the summed cost", () => {
    const e = [est("a", 10_000, 0.1), est("b", 30_000, 0.2), est("c", 20_000, 0.3)];
    const t = totalEstimate(["a", "b", "c"], e, 3);
    expect(t.durationMs).toBe(30_000);
    expect(t.costUsd).toBeCloseTo(0.6);
    expect(t.partial).toBe(false);
  });

  it("5 agents on cap 3 queue behind the longest ones", () => {
    const e = [10, 10, 10, 10, 10].map((s, i) => est(`a${i}`, s * 1000, 0.01));
    expect(totalEstimate(["a0", "a1", "a2", "a3", "a4"], e, 3).durationMs).toBe(20_000);
    const mixed = [est("x", 50_000, 0), est("y", 20_000, 0), est("z", 20_000, 0), est("w", 20_000, 0)];
    expect(totalEstimate(["x", "y", "z", "w"], mixed, 3).durationMs).toBe(50_000);
  });

  it("no estimates: nulls and partial; some missing: partial with the known totals", () => {
    expect(totalEstimate(["a"], [est("a", null, null)], 3)).toEqual({ durationMs: null, costUsd: null, partial: true });
    expect(totalEstimate(["a"], undefined, 3).partial).toBe(true);
    const t = totalEstimate(["a", "b"], [est("a", 5000, 0.1), est("b", null, null)], 3);
    expect(t).toMatchObject({ durationMs: 5000, partial: true });
    expect(t.costUsd).toBeCloseTo(0.1);
  });
});
