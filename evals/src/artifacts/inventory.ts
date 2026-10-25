/**
 * What artifacts exist, and which of them have evals. Shared by the scaffold CLI (listing) and
 * the CI planner (mapping a PR's changed paths onto the evals that must run). Pure filesystem
 * reads — no model, no git.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, AGENTS_DIR, EVALS_DIR } from "./paths.js";

export type Tier = "skills" | "agents";

export interface Inventory {
  skills: string[];
  agents: string[];
  /** Names (per tier) that have an `evals/<tier>/<name>/<name>.eval.ts`. */
  evals: Record<Tier, string[]>;
}

export function listSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((d) => statSync(join(SKILLS_DIR, d)).isDirectory() && existsSync(join(SKILLS_DIR, d, "SKILL.md")))
    .sort();
}

export function listAgents(): string[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "INSIGHTS.md")
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

export const evalPath = (tier: Tier, name: string) => join(EVALS_DIR, tier, name, `${name}.eval.ts`);
export const hasEval = (tier: Tier, name: string) => existsSync(evalPath(tier, name));

/** Every eval folder under evals/<tier>/ that holds a `<name>.eval.ts`, whether or not the
 *  artifact still exists in .claude/ (a stale eval should still run — and fail loudly). */
export function listEvals(tier: Tier): string[] {
  const dir = join(EVALS_DIR, tier);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory() && hasEval(tier, d))
    .sort();
}

export function inventory(): Inventory {
  return {
    skills: listSkills(),
    agents: listAgents(),
    evals: { skills: listEvals("skills"), agents: listEvals("agents") },
  };
}
