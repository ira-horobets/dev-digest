import { describe, it, expect } from "vitest";
import { agentAccent } from "./agent-accent";

describe("agentAccent", () => {
  it("maps known reviewer names to their colour and icon", () => {
    expect(agentAccent({ id: "1", name: "Security Reviewer" })).toEqual({
      color: "var(--crit)",
      bg: "var(--crit-bg)",
      icon: "Shield",
    });
    expect(agentAccent({ id: "2", name: "Performance Reviewer" }).icon).toBe("Zap");
    expect(agentAccent({ id: "3", name: "Test Quality Reviewer" }).icon).toBe("FlaskConical");
    expect(agentAccent({ id: "4", name: "API Contract Reviewer" }).icon).toBe("Workflow");
  });

  it("gives an unknown name a stable palette colour from its id", () => {
    const a = agentAccent({ id: "agent-x", name: "Custom" });
    expect(a.icon).toBe("Cpu");
    expect(agentAccent({ id: "agent-x", name: "Renamed" })).toEqual(a);
  });
});
