/**
 * One markdown table per CI job: every case that ran, its outcome, judge score, turns, tokens
 * and duration — written to $GITHUB_STEP_SUMMARY (or stdout). Joins the trend reporter's
 * pass/fail (results/history.jsonl — the real vitest outcome, soft-fails included) with the
 * per-run record (results/records.jsonl — metrics, score, soft-fail note) on the test name.
 * No model, no git.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_DIR } from "../artifacts/paths.js";

interface HistoryRow { nodeid: string; outcome: string }
interface RecordRow {
  nodeid: string;
  label: string;
  score?: number;
  threshold?: number;
  num_turns: number;
  metrics: { durationMs: number; inputTokens: number; outputTokens: number };
  softFail?: string;
}

const readJsonl = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T)
    : [];

const testName = (nodeid: string) => nodeid.split(" > ").pop() ?? nodeid;

export function buildSummary(title: string): string {
  const history = readJsonl<HistoryRow>(join(RESULTS_DIR, "history.jsonl"));
  const records = readJsonl<RecordRow>(join(RESULTS_DIR, "records.jsonl"));
  if (!history.length && !records.length) return `## ${title}\n\n_no eval results recorded_\n`;

  const byName = new Map<string, RecordRow>();
  for (const r of records) byName.set(testName(r.nodeid), r); // last attempt wins (retries)

  const seen = new Set<string>();
  const lines = [
    `## ${title}`,
    "",
    "| case | outcome | score | turns | in / out tokens | s |",
    "|---|---|---|---|---|---|",
  ];
  let input = 0, output = 0, ms = 0, pass = 0, fail = 0, soft = 0;

  const row = (name: string, outcome: string, r?: RecordRow) => {
    seen.add(name);
    const score = r?.score !== undefined ? `${r.score.toFixed(2)} / ${r.threshold ?? "-"}` : "-";
    const tokens = r ? `${r.metrics.inputTokens} / ${r.metrics.outputTokens}` : "-";
    const secs = r ? (r.metrics.durationMs / 1000).toFixed(0) : "-";
    const mark = outcome === "pass" ? (r?.softFail ? "⚠️ soft-fail" : "✅ pass") : outcome === "fail" ? "❌ fail" : outcome;
    if (outcome === "pass") pass++; else if (outcome === "fail") fail++;
    if (r?.softFail) soft++;
    if (r) { input += r.metrics.inputTokens; output += r.metrics.outputTokens; ms += r.metrics.durationMs; }
    lines.push(`| ${name} | ${mark} | ${score} | ${r?.num_turns ?? "-"} | ${tokens} | ${secs} |`);
  };

  // Only leaf tests: the reporter also walks suites, whose names are "skill:x" / "workflow:x".
  for (const h of history) {
    const name = testName(h.nodeid);
    if (/^(skill|agent|workflow):/.test(name) || seen.has(name)) continue;
    row(name, h.outcome, byName.get(name));
  }
  for (const [name, r] of byName) if (!seen.has(name)) row(name, "recorded", r);

  lines.push("", `**${pass} passed, ${fail} failed${soft ? `, ${soft} soft-failed` : ""}** · ${input} in / ${output} out tokens · ${(ms / 1000).toFixed(0)}s of model time`);
  const softRows = records.filter((r) => r.softFail);
  if (softRows.length) {
    lines.push("", "<details><summary>soft-fail details</summary>", "");
    for (const r of softRows) lines.push(`- **${testName(r.nodeid)}** — ${r.softFail!.split("\n")[0]}`);
    lines.push("", "</details>");
  }
  return lines.join("\n") + "\n";
}

const title = process.argv.slice(2).join(" ") || "evals";
const md = buildSummary(title);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(md);
