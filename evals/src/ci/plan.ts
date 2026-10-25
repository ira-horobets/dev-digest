/**
 * CI planner — turns the files a pull request changed into the evals that must run, so a PR
 * pays only for the artifacts it touched:
 *
 *   .claude/skills/<name>/**        → that skill's evals (warn when it has none)
 *   .claude/agents/<name>.md        → that agent's evals (warn when none) + the workflow tier,
 *                                     because dispatch of the agent is a harness-level fact
 *   CLAUDE.md, * /CLAUDE.md,
 *   .claude/CLAUDE.md, .claude/settings*.json
 *                                   → the workflow tier (CLAUDE.md routing, activation, dispatch)
 *   evals/skills/<name>/**,
 *   evals/agents/<name>/**          → that artifact's evals (the cases themselves changed)
 *   evals/workflow/**               → the workflow tier
 *   evals/src/**, evals/package.json, evals/proxy/**, evals/scripts/**, the CI files
 *                                   → everything (the harness changed under every case)
 *
 * Entries listed in evals/ci-skip.json ("<tier>/<name>": reason) are never put in the matrix —
 * A/B controls that fail by design, benchmarks, anything that is data rather than a gate.
 *
 * The mapping is a pure function (`planFromPaths`) so it is unit-tested without git. The CLI
 * wraps it: `tsx src/ci/plan.ts --base origin/main` diffs the merge-base against HEAD;
 * `--all` plans the full suite; bare paths plan from those paths (handy for a dry run).
 * Outputs go to $GITHUB_OUTPUT when set, and always to stdout.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, EVALS_DIR } from "../artifacts/paths.js";
import { inventory, type Inventory, type Tier } from "../artifacts/inventory.js";

export interface MatrixEntry {
  tier: Tier;
  name: string;
}

export interface Plan {
  matrix: MatrixEntry[];
  runWorkflow: boolean;
  /** Changed artifacts that have no evals, as "<tier>/<name>". */
  missing: string[];
  /** Why the whole suite is running, when it is. */
  fullReason?: string;
  /** Matrix entries removed by the skip list, as "<tier>/<name>". */
  skipped: string[];
}

/** Skip list: { "<tier>/<name>": reason }. */
export type SkipList = Record<string, string>;

export function loadSkipList(file = join(EVALS_DIR, "ci-skip.json")): SkipList {
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith("_")));
}

function applySkip(plan: Plan, skip: SkipList): Plan {
  const key = (m: MatrixEntry) => `${m.tier}/${m.name}`;
  const skipped = plan.matrix.filter((m) => key(m) in skip).map(key);
  return { ...plan, matrix: plan.matrix.filter((m) => !(key(m) in skip)), skipped };
}

const FULL_SUITE = [
  /^evals\/src\//,
  /^evals\/package\.json$/,
  /^evals\/pnpm-lock\.yaml$/,
  /^evals\/vitest\.config\.ts$/,
  /^evals\/tsconfig\.json$/,
  /^evals\/proxy\//,
  /^evals\/scripts\//,
  /^\.github\/workflows\/evals\.yml$/,
  /^\.github\/actions\/eval-setup\//,
];

const WORKFLOW_TIER = [/^CLAUDE\.md$/, /\/CLAUDE\.md$/, /^\.claude\/settings(\.local)?\.json$/, /^evals\/workflow\//];

export function fullPlan(inv: Inventory, reason: string, skip: SkipList = {}): Plan {
  return applySkip({
    matrix: [
      ...inv.evals.skills.map((name) => ({ tier: "skills" as const, name })),
      ...inv.evals.agents.map((name) => ({ tier: "agents" as const, name })),
    ],
    runWorkflow: true,
    missing: [],
    fullReason: reason,
    skipped: [],
  }, skip);
}

export function planFromPaths(changed: string[], inv: Inventory, skip: SkipList = {}): Plan {
  const full = changed.find((p) => FULL_SUITE.some((re) => re.test(p)));
  if (full) return fullPlan(inv, `harness file changed: ${full}`, skip);

  const matrix = new Map<string, MatrixEntry>();
  const missing = new Set<string>();
  let runWorkflow = false;

  const want = (tier: Tier, name: string, mustExist: boolean) => {
    if (inv.evals[tier].includes(name)) {
      matrix.set(`${tier}/${name}`, { tier, name });
    } else if (mustExist || (tier === "skills" ? inv.skills : inv.agents).includes(name)) {
      missing.add(`${tier}/${name}`);
    }
  };

  for (const p of changed) {
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^\.claude\/skills\/([^/]+)\//))) {
      // Only real skills (a dir with SKILL.md) count; .claude/skills/README.md etc. are ignored.
      if (inv.skills.includes(m[1])) want("skills", m[1], false);
    } else if ((m = p.match(/^\.claude\/agents\/([^/]+)\.md$/))) {
      if (inv.agents.includes(m[1])) {
        want("agents", m[1], false);
        runWorkflow = true;
      }
    } else if ((m = p.match(/^evals\/(skills|agents)\/([^/]+)\//))) {
      want(m[1] as Tier, m[2], true);
    } else if (WORKFLOW_TIER.some((re) => re.test(p))) {
      runWorkflow = true;
    }
  }

  return applySkip({ matrix: [...matrix.values()], runWorkflow, missing: [...missing].sort(), skipped: [] }, skip);
}

export function onlyTier(plan: Plan, tier: string): Plan {
  if (tier === "workflow") return { ...plan, matrix: [] };
  if (tier === "skills" || tier === "agents") {
    return { ...plan, matrix: plan.matrix.filter((m) => m.tier === tier), runWorkflow: false };
  }
  throw new Error(`--only expects workflow|skills|agents, got '${tier}'`);
}

// --- CLI --------------------------------------------------------------------

function changedSince(base: string): string[] {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const mergeBase = git("merge-base", base, "HEAD");
  const out = git("diff", "--name-only", mergeBase, "HEAD");
  return out ? out.split("\n").filter(Boolean) : [];
}

function emit(key: string, value: string): void {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const inv = inventory();
  const skip = loadSkipList();
  let changed: string[] = [];
  let plan: Plan;

  const baseIdx = argv.indexOf("--base");
  if (argv.includes("--all")) {
    plan = fullPlan(inv, "requested (--all)", skip);
  } else if (baseIdx !== -1) {
    const base = argv[baseIdx + 1];
    if (!base) throw new Error("usage: plan.ts --base <ref>");
    changed = changedSince(base);
    plan = planFromPaths(changed, inv, skip);
  } else {
    changed = argv;
    plan = planFromPaths(changed, inv, skip);
  }

  // --only workflow|skills|agents narrows any plan to one tier (manual dispatch, cheap re-checks).
  const onlyIdx = argv.indexOf("--only");
  if (onlyIdx !== -1) plan = onlyTier(plan, argv[onlyIdx + 1] ?? "");

  if (changed.length) console.error(`changed (${changed.length}):\n  ${changed.join("\n  ")}`);
  if (plan.fullReason) console.error(`full suite: ${plan.fullReason}`);

  emit("matrix", JSON.stringify({ include: plan.matrix }));
  emit("has_matrix", String(plan.matrix.length > 0));
  emit("run_workflow", String(plan.runWorkflow));
  emit("missing", JSON.stringify(plan.missing));
  emit("skipped", JSON.stringify(plan.skipped));

  if (process.env.GITHUB_ACTIONS) {
    for (const s of plan.skipped) console.log(`::notice title=eval skipped by ci-skip.json::${s}: ${skip[s]}`);
    for (const m of plan.missing) {
      console.log(`::warning title=no evals for changed artifact::${m} changed but has no evals — pnpm eval:scaffold`);
    }
  }
}

// Run the CLI only when executed directly (tsx src/ci/plan.ts …), not when imported by the tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
