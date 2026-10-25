/**
 * Case types + the runners that turn a data array into vitest tests. This module owns the ONE
 * true measure → (log) → assert body, so case authors never rewrite it — which is exactly what
 * keeps the "assert before record" bug from recurring once record() lands (T2 slots into the
 * marked spot below, in this one file).
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { DEFAULT_THRESHOLD, SOFT_KINDS } from "../config.js";
import { YELLOW, RESET } from "../ansi.js";
import { skillTask, agentTask, workflowTask } from "../tasks.js";
import { runClaude, type Result, type RunOptions } from "../runtime/run-claude.js";
import { patternMatch } from "../scoring/pattern-match.js";
import { llmJudge, type Verdict } from "../scoring/llm-judge.js";
import { logTrace, logVerdict } from "../logging/log.js";
import { record } from "../records/record.js";

// --- Case shapes ------------------------------------------------------------

/** A judge-and-grounding case. Same shape for skills and agents; only the task differs. */
export interface QualityCase {
  name: string;
  kind?: "quality" | "grounding";
  prompt: string;
  /** Practices the judge scores (quality). Omit for a pure grounding case. */
  practices?: string[];
  /** Substrings that must ALL appear before the judge runs (cheap-tier gate). */
  grounding?: string[];
  /** Judge score gate (default 0.6). */
  threshold?: number;
  maxTurns?: number;
}
export type SkillCase = QualityCase;
export type AgentCase = QualityCase;

/** A trace-asserted workflow case — a discriminated union routed by `kind`. */
export type WorkflowCase =
  | { kind: "dispatch"; name: string; prompt: string; expectSubagent: string; maxTurns?: number }
  | {
      kind: "activation";
      name: string;
      prompt: string;
      skill: string;
      shouldActivate: boolean;
      maxTurns?: number;
    }
  | {
      kind: "contrast";
      name: string;
      prompt: string;
      expectFileRead: string;
      tools?: string[];
      maxTurns?: number;
    }
  | {
      // A single-session composite: run ONE workflowTask and assert several trace facets at once.
      // Cheaper than separate dispatch/activation/contrast cases (one session, not N) at the cost
      // of coarser diagnostics and no control run — use contrast when you must isolate CLAUDE.md's
      // contribution. Every provided expectation must hold; omitted fields are not checked.
      kind: "trace";
      name: string;
      prompt: string;
      expectSubagents?: string[];
      expectSkills?: string[];
      expectFilesRead?: string[];
      maxTurns?: number;
    };

/** Did a skill engage? Either an explicit Skill tool-call, or reading its SKILL.md. */
export function activated(result: Result, skill: string): boolean {
  const bySkill = result.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`));
  const byRead = result.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
  return bySkill || byRead;
}

// --- Runners ----------------------------------------------------------------

type Task = (prompt: string, artifact: string, opts?: RunOptions) => Promise<Result>;

function runQualityCases(artifact: string, cases: QualityCase[], task: Task): void {
  for (const c of cases) {
    test(c.name, async () => {
      const threshold = c.threshold ?? DEFAULT_THRESHOLD;
      const result = await task(c.prompt, artifact, { maxTurns: c.maxTurns });
      logTrace(c.name, result);

      // measure → record → assert. Everything measurable runs in the try; record() fires in the
      // finally with whatever accumulated; the asserts happen strictly after. A failing config
      // (e.g. baseline: grounding gate fails, judge skipped) still leaves a record.
      let grounded: number | undefined;
      let verdict: Verdict | undefined;
      try {
        // Cheap deterministic tier first — the grounding gate. When it fails the judge is skipped.
        if (c.grounding?.length) grounded = patternMatch(result.text, c.grounding);
        if (c.practices?.length && (grounded === undefined || grounded === 1)) {
          verdict = await llmJudge(result.text, c.practices);
          logVerdict(c.name, verdict);
        }
      } finally {
        record(c.name, { result, verdict, grounded, threshold });
      }

      if (grounded !== undefined) {
        expect(grounded, `missing concrete evidence; output:\n${result.text}`).toBe(1);
      }
      if (verdict) {
        expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(threshold);
      }
    });
  }
}

export const runSkillCases = (skill: string, cases: SkillCase[]) => runQualityCases(skill, cases, skillTask);
export const runAgentCases = (agent: string, cases: AgentCase[]) => runQualityCases(agent, cases, agentTask);

/**
 * Run a case's assertions. For a kind listed in EVAL_SOFT_KINDS a failure is downgraded: the
 * message is logged (and surfaced as a GitHub annotation under Actions), the test passes, and
 * the returned note is stored on the record so the soft-fail is still visible in the data.
 */
function assertSoftly(kind: WorkflowCase["kind"], name: string, assertions: () => void): string | undefined {
  try {
    assertions();
    return undefined;
  } catch (err) {
    if (!SOFT_KINDS.has(kind)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${YELLOW}soft-fail${RESET} [${kind}] ${name}\n  ${msg.split("\n")[0]}`);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::warning title=eval soft-fail (${kind})::${name}: ${msg.split("\n")[0]}`);
    }
    return msg;
  }
}

const softExtra = (softFail: string | undefined) => (softFail ? { softFail } : undefined);

export function runWorkflowCases(cases: WorkflowCase[]): void {
  for (const c of cases) {
    test(c.name, async () => {
      if (c.kind === "dispatch") {
        // Stop the moment the subagent is launched — no need to wait out its nested session.
        const expect1 = c.expectSubagent;
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) => p.subagents.includes(expect1),
        });
        logTrace(c.name, result);
        let soft: string | undefined;
        try {
          soft = assertSoftly(c.kind, c.name, () => {
            expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(c.expectSubagent);
          });
        } finally {
          record(c.name, { result, extra: softExtra(soft) });
        }
      } else if (c.kind === "activation") {
        const result = await workflowTask(c.prompt, { maxTurns: c.maxTurns });
        logTrace(c.name, result);
        let soft: string | undefined;
        try {
          soft = assertSoftly(c.kind, c.name, () => {
            expect(
              activated(result, c.skill),
              `skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
            ).toBe(c.shouldActivate);
          });
        } finally {
          record(c.name, { result, extra: softExtra(soft) });
        }
      } else if (c.kind === "trace") {
        // One session, many asserts — every provided expectation is checked against the same trace.
        // Stop as soon as ALL expectations are satisfied (e.g. doc read + subagent launched), so a
        // dispatch-bearing trace doesn't pay for the nested subagent's full run.
        const subs = c.expectSubagents ?? [];
        const skls = c.expectSkills ?? [];
        const files = c.expectFilesRead ?? [];
        const skillEngaged = (p: { skillsInvoked: string[]; filesRead: string[] }, skill: string) =>
          p.skillsInvoked.some((s) => s === skill || s.endsWith(`:${skill}`)) ||
          p.filesRead.some((f) => f.includes(`skills/${skill}/SKILL.md`));
        const result = await workflowTask(c.prompt, {
          maxTurns: c.maxTurns,
          stopWhen: (p) =>
            subs.every((s) => p.subagents.includes(s)) &&
            skls.every((s) => skillEngaged(p, s)) &&
            files.every((f) => p.filesRead.some((r) => r.includes(f))),
        });
        logTrace(c.name, result);
        let soft: string | undefined;
        try {
          soft = assertSoftly(c.kind, c.name, () => {
            for (const sub of c.expectSubagents ?? []) {
              expect(result.subagents, `subagents: ${result.subagents.join(", ")}`).toContain(sub);
            }
            for (const skill of c.expectSkills ?? []) {
              expect(
                activated(result, skill),
                `skill ${skill} not engaged | skills: ${result.skillsInvoked.join(", ")} | reads: ${result.filesRead.join(", ")}`,
              ).toBe(true);
            }
            for (const file of c.expectFilesRead ?? []) {
              expect(
                result.filesRead.some((f) => f.includes(file)),
                `${file} not read | reads: ${result.filesRead.join(", ")}`,
              ).toBe(true);
            }
            expect(result.isError).toBe(false);
          });
        } finally {
          record(c.name, { result, extra: softExtra(soft) });
        }
      } else {
        // contrast: treatment (real harness) vs control (empty tmpdir, no on-disk config).
        const tools = c.tools ?? ["Read", "Grep", "Glob"];
        const treatment = await workflowTask(c.prompt, { allowedTools: tools, maxTurns: c.maxTurns });
        const emptyCwd = mkdtempSync(join(tmpdir(), "eval-control-"));
        const control = await runClaude(c.prompt, {
          allowedTools: tools,
          maxTurns: c.maxTurns,
          cwd: emptyCwd,
          settingSources: [],
        });
        logTrace(`${c.name} [treatment]`, treatment);
        logTrace(`${c.name} [control]`, control);
        let soft: string | undefined;
        try {
          soft = assertSoftly(c.kind, c.name, () => {
            const treatmentRead = treatment.filesRead.some((f) => f.includes(c.expectFileRead));
            const controlRead = control.filesRead.some((f) => f.includes(c.expectFileRead));
            expect(treatmentRead, `treatment reads: ${treatment.filesRead.join(", ")}`).toBe(true);
            expect(controlRead, `control reads: ${control.filesRead.join(", ")}`).toBe(false);
          });
        } finally {
          record(`${c.name} [treatment]`, { result: treatment, extra: softExtra(soft) });
          record(`${c.name} [control]`, { result: control, extra: softExtra(soft) });
        }
      }
    });
  }
}
