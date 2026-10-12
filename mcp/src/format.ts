import type { Agent, ConventionsView, FindingRecord, RunFindings } from '@devdigest/shared';

import type { ResponseFormat, Severity } from './schemas.js';

export type { ResponseFormat, Severity };
export type ConventionFilter = 'accepted' | 'candidate' | 'rejected' | 'all';

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
const CONCISE_LIMIT = 15;
const DETAILED_LIMIT = 50;
const MAX_TEXT_CHARS = 40_000;
const SUMMARY_MAX = 300;
const LONG_TEXT_MAX = 800;
const DESCRIPTION_MAX = 200;

function clip(s: string | null | undefined, max: number): string | null {
  if (s === null || s === undefined) return null;
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function shapeAgents(agents: Agent[], includeDisabled: boolean) {
  return agents
    .filter((a) => includeDisabled || a.enabled)
    .map((a) => ({
      id: a.id,
      name: a.name,
      description: clip(a.description, DESCRIPTION_MAX),
      provider: a.provider,
      model: a.model,
      enabled: a.enabled,
      strategy: a.strategy,
      skill_count: a.skill_count,
      runs: a.stats?.runs ?? 0,
    }));
}

function sortFindings(fs: FindingRecord[]): FindingRecord[] {
  return [...fs].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) || b.confidence - a.confidence,
  );
}

export interface FindingsOptions {
  format: ResponseFormat;
  minSeverity: Severity;
}

export function shapeFindings(data: RunFindings, opts: FindingsOptions) {
  const all = data.findings;
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of all) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  const floor = SEVERITY_RANK[opts.minSeverity] ?? 1;
  const eligible = sortFindings(all.filter((f) => (SEVERITY_RANK[f.severity] ?? 0) >= floor));
  const limit = opts.format === 'detailed' ? DETAILED_LIMIT : CONCISE_LIMIT;
  const toItem = (f: FindingRecord) =>
    opts.format === 'detailed'
      ? {
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          file: f.file,
          line: f.start_line,
          end_line: f.end_line,
          confidence: f.confidence,
          rationale: clip(f.rationale, LONG_TEXT_MAX),
          suggestion: clip(f.suggestion ?? null, LONG_TEXT_MAX),
        }
      : { severity: f.severity, category: f.category, title: f.title, file: f.file, line: f.start_line };

  let shown = eligible.slice(0, limit).map(toItem);
  const build = (items: unknown[], truncated: boolean) => ({
    run_id: data.run.run_id,
    agent_name: data.run.agent_name,
    status: data.run.status,
    verdict: data.review?.verdict ?? null,
    score: data.review?.score ?? data.run.score,
    summary: clip(data.review?.summary ?? null, SUMMARY_MAX),
    counts,
    blockers: data.run.blockers,
    cost_usd: data.run.cost_usd,
    findings: items,
    omitted: all.length - items.length,
    ...(truncated ? { truncated: true } : {}),
  });
  let out = build(shown, false);
  while (JSON.stringify(out).length > MAX_TEXT_CHARS && shown.length > 0) {
    shown = shown.slice(0, Math.max(0, shown.length - 5));
    out = build(shown, true);
  }
  return out;
}

export function shapeConventions(repo: string, view: ConventionsView, filter: ConventionFilter) {
  const counts: Record<string, number> = {};
  for (const c of view.candidates) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const rules = view.candidates
    .filter((c) => filter === 'all' || c.status === filter)
    .map((c) => ({
      category: c.category,
      rule: c.rule,
      evidence: `${c.evidence_path}:${c.evidence_line}`,
      confidence: c.confidence,
    }));
  const base = {
    repo,
    scan: view.scan
      ? { status: view.scan.status, finished_at: view.scan.finished_at, model: view.scan.model }
      : null,
    rules,
    counts_by_status: counts,
  };
  if (filter === 'accepted' && rules.length === 0) {
    return {
      ...base,
      note:
        'No accepted conventions yet. Accept candidates on the Conventions page of the DevDigest app, ' +
        'or run a scan there first; pass status "candidate" or "all" to see unreviewed rules.',
    };
  }
  return base;
}
