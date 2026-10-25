import type {
  EvalActualFinding,
  EvalCaseOutcome,
  EvalExpectation,
  EvalMetricDeltas,
  EvalRun,
} from '@devdigest/shared';

/**
 * Pure, zero-I/O, zero-LLM scoring — the ENTIRE scoring surface of the eval
 * pipeline. A finding "counts" when its file equals the expectation's file
 * AND the two line ranges intersect — the same shape of comparison the
 * citation-grounding gate applies to a diff hunk, applied to an expectation.
 */

/** The subset of a `Finding` scoring needs (structural — no contract import). */
export interface ScoredFinding {
  file: string;
  start_line: number;
  end_line: number;
  severity: string;
  category: string;
  title: string;
}

export function matches(finding: ScoredFinding, expectation: EvalExpectation): boolean {
  if (finding.file !== expectation.file) return false;
  const fLo = Math.min(finding.start_line, finding.end_line);
  const fHi = Math.max(finding.start_line, finding.end_line);
  const eLo = Math.min(expectation.start_line, expectation.end_line);
  const eHi = Math.max(expectation.start_line, expectation.end_line);
  return fLo <= eHi && eLo <= fHi;
}

export interface ScoreCaseInput {
  caseId: string;
  name: string;
  expectation: EvalExpectation;
  /** GROUNDED (kept) findings only — a dropped finding is never a match. */
  findings: ScoredFinding[];
  groundingKept: number;
  groundingTotal: number;
  durationMs: number;
  costUsd: number | null;
}

/** `must_find` passes on ≥1 matching finding; `must_not_flag` on ZERO. */
export function scoreCase(input: ScoreCaseInput): EvalCaseOutcome {
  const actual: EvalActualFinding[] = input.findings.map((f) => ({
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    matched: matches(f, input.expectation),
  }));
  const matchedCount = actual.filter((f) => f.matched).length;
  const pass = input.expectation.type === 'must_find' ? matchedCount > 0 : matchedCount === 0;

  return {
    case_id: input.caseId,
    name: input.name,
    expectation_type: input.expectation.type,
    status: 'scored',
    pass,
    error_reason: null,
    findings_total: input.findings.length,
    findings_matched: matchedCount,
    grounding_kept: input.groundingKept,
    grounding_total: input.groundingTotal,
    duration_ms: input.durationMs,
    cost_usd: input.costUsd,
    actual,
  };
}

/** A case whose execution threw: `pass: null`, excluded from every ratio. */
export function errorCaseOutcome(
  caseId: string,
  name: string,
  expectationType: EvalExpectation['type'],
  reason: string,
  durationMs: number,
): EvalCaseOutcome {
  return {
    case_id: caseId,
    name,
    expectation_type: expectationType,
    status: 'errored',
    pass: null,
    error_reason: reason,
    findings_total: 0,
    findings_matched: 0,
    grounding_kept: 0,
    grounding_total: 0,
    duration_ms: durationMs,
    cost_usd: null,
    actual: [],
  };
}

function sumNullable(values: (number | null)[]): number | null {
  let sum = 0;
  for (const v of values) {
    if (v == null) return null;
    sum += v;
  }
  return sum;
}

/**
 * Set-level metrics over a run's outcomes. Errored cases contribute to
 * NEITHER numerator NOR denominator. Every ratio is `null` (never 0) when its
 * denominator is zero.
 *
 *  recall            = must_find cases passed / must_find cases
 *  precision         = 1 − FP / total kept findings, where FP = findings that
 *                      matched a must_not_flag expectation (dismissed cases
 *                      are exactly what feeds this term)
 *  citation_accuracy = findings kept by the grounding gate / findings emitted
 */
export function scoreRun(outcomes: EvalCaseOutcome[], durationMs: number): EvalRun {
  const scored = outcomes.filter((o) => o.status === 'scored');
  const casesErrored = outcomes.length - scored.length;

  const mustFind = scored.filter((o) => o.expectation_type === 'must_find');
  const recall = mustFind.length > 0 ? mustFind.filter((o) => o.pass).length / mustFind.length : null;

  const totalFindings = scored.reduce((n, o) => n + o.findings_total, 0);
  const falsePositives = scored
    .filter((o) => o.expectation_type === 'must_not_flag')
    .reduce((n, o) => n + o.findings_matched, 0);
  const precision = totalFindings > 0 ? 1 - falsePositives / totalFindings : null;

  const groundingKept = scored.reduce((n, o) => n + o.grounding_kept, 0);
  const groundingTotal = scored.reduce((n, o) => n + o.grounding_total, 0);
  const citationAccuracy = groundingTotal > 0 ? groundingKept / groundingTotal : null;

  return {
    recall,
    precision,
    citation_accuracy: citationAccuracy,
    traces_passed: scored.filter((o) => o.pass).length,
    traces_total: outcomes.length,
    cases_errored: casesErrored,
    duration_ms: durationMs,
    cost_usd: sumNullable(outcomes.map((o) => o.cost_usd)),
    per_case: outcomes,
  };
}

/** Metrics recomputed over an explicit subset of case ids (apples-to-apples
 *  comparison of two runs whose case sets differ). */
export function metricsOverCases(run: EvalRun, caseIds: ReadonlySet<string>): EvalRun {
  return scoreRun(
    run.per_case.filter((o) => caseIds.has(o.case_id)),
    run.duration_ms,
  );
}

function nullableDelta(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : b - a;
}

/** `b − a` per metric; `null` whenever either side is not applicable. */
export function metricDeltas(a: EvalRun, b: EvalRun): EvalMetricDeltas {
  return {
    recall: nullableDelta(a.recall, b.recall),
    precision: nullableDelta(a.precision, b.precision),
    citation_accuracy: nullableDelta(a.citation_accuracy, b.citation_accuracy),
  };
}

/** Cases whose pass/fail flipped between two runs (only cases scored in both). */
export function caseTransitions(
  previous: EvalRun,
  latest: EvalRun,
): { case_id: string; name: string; from: boolean; to: boolean }[] {
  const prior = new Map(previous.per_case.map((c) => [c.case_id, c]));
  return latest.per_case.flatMap((c) => {
    if (c.status !== 'scored' || c.pass === null) return [];
    const p = prior.get(c.case_id);
    if (!p || p.status !== 'scored' || p.pass === null || p.pass === c.pass) return [];
    return [{ case_id: c.case_id, name: c.name, from: p.pass, to: c.pass }];
  });
}
