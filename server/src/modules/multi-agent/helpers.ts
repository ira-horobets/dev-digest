/**
 * multi-agent — pure helpers (ring 2): column mapping, parent aggregation,
 * location grouping and conflict classification. Deterministic, no model call,
 * nothing here is stored.
 */
import type {
  AgentColumn,
  AgentEstimate,
  Conflict,
  ConflictTake,
  MultiAgentRun,
  Severity,
} from '@devdigest/shared';
import type { ChildFinding, ChildRun, EstimateRow, MultiRunData } from './ports.js';

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
const rank = (s: string) => SEVERITY_RANK[s] ?? 0;

const COLUMN_STATUSES = ['done', 'failed', 'cancelled'] as const;

export function toColumn(child: ChildRun): AgentColumn {
  const status = (COLUMN_STATUSES as readonly (string | null)[]).includes(child.status)
    ? (child.status as 'done' | 'failed' | 'cancelled')
    : 'running';
  return {
    run_id: child.runId,
    agent_id: child.agentId,
    agent_name: child.agentName ?? 'Deleted agent',
    provider: child.provider,
    model: child.model,
    status,
    error: status === 'failed' || status === 'cancelled' ? (child.error ?? null) : null,
    verdict: child.review?.verdict ?? null,
    score: child.review?.score ?? null,
    summary: child.review?.summary ?? null,
    duration_ms: child.durationMs,
    cost_usd: child.costUsd,
    findings: child.findings.map((f) => ({
      id: f.id,
      severity: f.severity as Severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      kind: f.kind,
    })),
  };
}

export interface ParentAggregate {
  status: 'running' | 'done' | 'failed';
  totalDurationMs: number;
  totalCostUsd: number | null;
}

/** running if any child runs; failed if every child failed or was cancelled; else done. */
export function aggregateParent(children: Pick<AgentColumn, 'status' | 'duration_ms' | 'cost_usd'>[]): ParentAggregate {
  const status = children.some((c) => c.status === 'running')
    ? 'running'
    : children.every((c) => c.status === 'failed' || c.status === 'cancelled')
      ? 'failed'
      : 'done';
  const costs = children.map((c) => c.cost_usd).filter((c): c is number => c !== null);
  return {
    status,
    totalDurationMs: children.reduce((m, c) => Math.max(m, c.duration_ms ?? 0), 0),
    totalCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
  };
}

interface Entry {
  col: number;
  finding: ChildFinding;
}

export interface LocationGroup {
  file: string;
  entries: Entry[];
}

/**
 * Group findings of the columns into locations: same file and an overlapping
 * range, or a start within `tolerance` lines of the previous finding's start.
 * Order is fixed (file, start, end, column order, id), so the result does not
 * depend on the input order of findings.
 */
export function groupLocations(columns: AgentColumn[], findingsByRun: Map<string, ChildFinding[]>, tolerance: number): LocationGroup[] {
  const entries: Entry[] = [];
  columns.forEach((c, col) => {
    for (const finding of findingsByRun.get(c.run_id) ?? []) entries.push({ col, finding });
  });
  entries.sort(
    (a, b) =>
      a.finding.file.localeCompare(b.finding.file) ||
      a.finding.startLine - b.finding.startLine ||
      a.finding.endLine - b.finding.endLine ||
      a.col - b.col ||
      a.finding.id.localeCompare(b.finding.id),
  );
  const groups: LocationGroup[] = [];
  let maxEnd = 0;
  let lastStart = 0;
  for (const e of entries) {
    const open = groups[groups.length - 1];
    const f = e.finding;
    if (open && open.file === f.file && (f.startLine <= maxEnd || f.startLine - lastStart <= tolerance)) {
      open.entries.push(e);
      maxEnd = Math.max(maxEnd, f.endLine);
      lastStart = f.startLine;
    } else {
      groups.push({ file: f.file, entries: [e] });
      maxEnd = f.endLine;
      lastStart = f.startLine;
    }
  }
  return groups;
}

/** One cell per column; `conflict` per the flagged-vs-silent and divergent-severity rules. */
export function classify(group: LocationGroup, columns: AgentColumn[]): Conflict {
  const byCol = new Map<number, Entry>();
  for (const e of group.entries) {
    const best = byCol.get(e.col);
    // Highest severity wins; entries arrive sorted, so a tie keeps the first.
    if (!best || rank(e.finding.severity) > rank(best.finding.severity)) byCol.set(e.col, e);
  }
  const takes: ConflictTake[] = columns.map((c, col) => {
    const hit = byCol.get(col);
    const base = { agent_id: c.agent_id ?? c.run_id, run_id: c.run_id, persona: c.agent_name };
    if (hit) return { ...base, verdict: hit.finding.severity as Severity, note: hit.finding.title };
    return { ...base, verdict: c.status === 'done' ? ('ignored' as const) : ('no_result' as const), note: '' };
  });
  const severities = new Set([...byCol.values()].map((e) => e.finding.severity));
  const silentDone = takes.some((t) => t.verdict === 'ignored');
  const top = [...byCol.values()].reduce((a, b) => (rank(b.finding.severity) > rank(a.finding.severity) ? b : a));
  return {
    file: group.file,
    line: Math.min(...group.entries.map((e) => e.finding.startLine)),
    end_line: Math.max(...group.entries.map((e) => e.finding.endLine)),
    title: top.finding.title,
    conflict: silentDone || severities.size > 1,
    takes,
  };
}

/** The full `MultiAgentRun` read model for one parent. */
export function buildMultiAgentRun(data: MultiRunData, lineTolerance: number): MultiAgentRun {
  const columns = data.children.map(toColumn);
  const agg = aggregateParent(columns);
  const findingsByRun = new Map(data.children.map((c) => [c.runId, c.findings]));
  const conflicts = groupLocations(columns, findingsByRun, lineTolerance).map((g) => classify(g, columns));
  return {
    id: data.parent.id,
    pr_id: data.parent.prId,
    pr_number: data.parent.prNumber,
    ran_at: data.parent.ranAt,
    status: agg.status,
    agent_count: columns.length,
    total_duration_ms: agg.totalDurationMs,
    total_cost_usd: agg.totalCostUsd,
    columns,
    conflicts,
  };
}

/** Average duration and cost over the sampled runs; nulls when there are none. */
export function toEstimate(agentId: string, rows: EstimateRow[]): AgentEstimate {
  const durations = rows.map((r) => r.durationMs).filter((d): d is number => d !== null);
  const costs = rows.map((r) => r.costUsd).filter((c): c is number => c !== null);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    agent_id: agentId,
    duration_ms: durations.length > 0 ? Math.round(avg(durations)) : null,
    cost_usd: costs.length > 0 ? avg(costs) : null,
    samples: rows.length,
  };
}
