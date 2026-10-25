/**
 * The CI path → eval mapping, on a fixed inventory. No git, no model.
 *   pnpm vitest run src/ci/plan.test.ts
 */

import { describe, expect, test } from "vitest";
import { planFromPaths, fullPlan, onlyTier } from "./plan.js";
import type { Inventory } from "../artifacts/inventory.js";

const inv: Inventory = {
  skills: ["dependency-checker", "security", "zod"],
  agents: ["architecture-reviewer", "architecture-reviewer-lite"],
  evals: {
    skills: ["dependency-checker"],
    agents: ["architecture-reviewer", "architecture-reviewer-lite"],
  },
};

describe("planFromPaths", () => {
  test("a skill with evals → its matrix entry, no workflow tier", () => {
    const p = planFromPaths([".claude/skills/dependency-checker/SKILL.md"], inv);
    expect(p.matrix).toEqual([{ tier: "skills", name: "dependency-checker" }]);
    expect(p.runWorkflow).toBe(false);
    expect(p.missing).toEqual([]);
  });

  test("a skill without evals → reported missing, nothing runs", () => {
    const p = planFromPaths([".claude/skills/security/references/owasp.md"], inv);
    expect(p.matrix).toEqual([]);
    expect(p.missing).toEqual(["skills/security"]);
  });

  test("non-skill files under .claude/skills are ignored", () => {
    const p = planFromPaths([".claude/skills/README.md"], inv);
    expect(p).toMatchObject({ matrix: [], runWorkflow: false, missing: [] });
  });

  test("an agent → its evals AND the workflow tier", () => {
    const p = planFromPaths([".claude/agents/architecture-reviewer.md"], inv);
    expect(p.matrix).toEqual([{ tier: "agents", name: "architecture-reviewer" }]);
    expect(p.runWorkflow).toBe(true);
  });

  test("agents INSIGHTS.md is not an agent", () => {
    const p = planFromPaths([".claude/agents/INSIGHTS.md"], inv);
    expect(p).toMatchObject({ matrix: [], runWorkflow: false });
  });

  test("any CLAUDE.md → the workflow tier only", () => {
    for (const f of ["CLAUDE.md", "server/CLAUDE.md", ".claude/CLAUDE.md"]) {
      const p = planFromPaths([f], inv);
      expect(p.matrix, f).toEqual([]);
      expect(p.runWorkflow, f).toBe(true);
    }
  });

  test("changed cases → that artifact's evals; a stale eval folder is still run", () => {
    const p = planFromPaths(["evals/agents/architecture-reviewer-lite/x.cases.ts"], inv);
    expect(p.matrix).toEqual([{ tier: "agents", name: "architecture-reviewer-lite" }]);
    const stale = planFromPaths(["evals/skills/gone/gone.cases.ts"], inv);
    expect(stale.missing).toEqual(["skills/gone"]);
  });

  test("evals/workflow changes → the workflow tier", () => {
    expect(planFromPaths(["evals/workflow/review-workflow.cases.ts"], inv).runWorkflow).toBe(true);
  });

  test("harness changes → the full suite", () => {
    for (const f of ["evals/src/tasks.ts", "evals/package.json", ".github/workflows/evals.yml", "evals/proxy/litellm.config.yaml"]) {
      const p = planFromPaths([f, ".claude/skills/security/SKILL.md"], inv);
      expect(p.matrix, f).toHaveLength(3);
      expect(p.runWorkflow, f).toBe(true);
      expect(p.fullReason, f).toContain(f);
      expect(p.missing, f).toEqual([]); // the full suite supersedes per-artifact warnings
    }
  });

  test("a skip-listed eval never enters the matrix, and is reported", () => {
    const skip = { "agents/architecture-reviewer-lite": "A/B control" };
    const full = fullPlan(inv, "test", skip);
    expect(full.matrix.map((m) => m.name)).toEqual(["dependency-checker", "architecture-reviewer"]);
    expect(full.skipped).toEqual(["agents/architecture-reviewer-lite"]);
    const one = planFromPaths([".claude/agents/architecture-reviewer-lite.md"], inv, skip);
    expect(one).toMatchObject({ matrix: [], runWorkflow: true, skipped: ["agents/architecture-reviewer-lite"] });
  });

  test("--only narrows a plan to one tier", () => {
    const full = fullPlan(inv, "test");
    expect(onlyTier(full, "workflow")).toMatchObject({ matrix: [], runWorkflow: true });
    expect(onlyTier(full, "skills")).toMatchObject({ matrix: [{ tier: "skills", name: "dependency-checker" }], runWorkflow: false });
    expect(onlyTier(full, "agents").matrix).toHaveLength(2);
    expect(() => onlyTier(full, "nope")).toThrow(/--only/);
  });

  test("duplicates collapse and unrelated files do nothing", () => {
    const p = planFromPaths(
      [".claude/skills/dependency-checker/SKILL.md", ".claude/skills/dependency-checker/scripts/a.ts", "server/src/app.ts"],
      inv,
    );
    expect(p.matrix).toHaveLength(1);
    expect(planFromPaths(["server/src/app.ts", "README.md"], inv)).toMatchObject({ matrix: [], runWorkflow: false });
  });
});
