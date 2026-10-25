import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import {
  caseTransitions,
  errorCaseOutcome,
  matches,
  metricDeltas,
  metricsOverCases,
  scoreCase,
  scoreRun,
} from '../src/modules/eval/scoring.js';

/**
 * The scoring surface is pure code — no model. These pin the rules the
 * spec states: a finding counts when the file matches AND the line ranges
 * intersect; recall / precision / citation_accuracy are computed from the
 * must_find / must_not_flag outcomes and the grounding counts.
 */

const mustFind: EvalExpectation = {
  type: 'must_find',
  file: 'src/config.ts',
  start_line: 12,
  end_line: 12,
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded Stripe key',
};
const mustNotFlag: EvalExpectation = { ...mustFind, type: 'must_not_flag', file: 'src/util.ts', start_line: 3, end_line: 9 };

const finding = (file: string, start: number, end: number) => ({
  file,
  start_line: start,
  end_line: end,
  severity: 'WARNING',
  category: 'bug',
  title: `f ${file}:${start}`,
});

describe('matches', () => {
  it('requires the same file', () => {
    expect(matches(finding('src/other.ts', 12, 12), mustFind)).toBe(false);
  });
  it('requires intersecting line ranges (inclusive, order-insensitive)', () => {
    expect(matches(finding('src/config.ts', 10, 12), mustFind)).toBe(true);
    expect(matches(finding('src/config.ts', 12, 10), mustFind)).toBe(true);
    expect(matches(finding('src/config.ts', 13, 20), mustFind)).toBe(false);
  });
});

describe('scoreCase', () => {
  const base = { groundingKept: 1, groundingTotal: 1, durationMs: 10, costUsd: 0.01 };

  it('must_find passes on at least one matching finding', () => {
    const o = scoreCase({ caseId: 'c1', name: 'n', expectation: mustFind, findings: [finding('src/config.ts', 12, 12)], ...base });
    expect(o.pass).toBe(true);
    expect(o.findings_matched).toBe(1);
    expect(o.actual[0]!.matched).toBe(true);
  });
  it('must_find fails with zero matching findings', () => {
    const o = scoreCase({ caseId: 'c1', name: 'n', expectation: mustFind, findings: [finding('src/config.ts', 40, 41)], ...base });
    expect(o.pass).toBe(false);
  });
  it('must_not_flag passes only with ZERO matching findings', () => {
    expect(scoreCase({ caseId: 'c2', name: 'n', expectation: mustNotFlag, findings: [], ...base }).pass).toBe(true);
    expect(
      scoreCase({ caseId: 'c2', name: 'n', expectation: mustNotFlag, findings: [finding('src/util.ts', 5, 5)], ...base }).pass,
    ).toBe(false);
  });
});

describe('scoreRun', () => {
  const base = { durationMs: 10, costUsd: 0.01 };

  it('computes recall over must_find cases, precision from must_not_flag hits, citation from grounding', () => {
    const outcomes = [
      // must_find hit (1 kept of 2 emitted)
      scoreCase({ caseId: 'a', name: 'a', expectation: mustFind, findings: [finding('src/config.ts', 12, 12)], groundingKept: 1, groundingTotal: 2, ...base }),
      // must_find miss (0 findings)
      scoreCase({ caseId: 'b', name: 'b', expectation: { ...mustFind, file: 'src/b.ts' }, findings: [], groundingKept: 0, groundingTotal: 0, ...base }),
      // must_not_flag violated: 2 findings, 1 matches the dismissed range
      scoreCase({
        caseId: 'c',
        name: 'c',
        expectation: mustNotFlag,
        findings: [finding('src/util.ts', 4, 4), finding('src/util.ts', 50, 50)],
        groundingKept: 2,
        groundingTotal: 2,
        ...base,
      }),
    ];
    const run = scoreRun(outcomes, 100);
    expect(run.recall).toBeCloseTo(0.5); // 1 of 2 must_find
    expect(run.precision).toBeCloseTo(1 - 1 / 3); // 1 FP of 3 kept findings
    expect(run.citation_accuracy).toBeCloseTo(3 / 4); // 3 kept of 4 emitted
    expect(run.traces_passed).toBe(1);
    expect(run.traces_total).toBe(3);
    expect(run.cost_usd).toBeCloseTo(0.03);
  });

  it('is null (not 0) when a denominator is empty, and errored cases count nowhere', () => {
    const run = scoreRun(
      [
        scoreCase({ caseId: 'c', name: 'c', expectation: mustNotFlag, findings: [], groundingKept: 0, groundingTotal: 0, ...base }),
        errorCaseOutcome('e', 'e', 'must_find', 'boom', 5),
      ],
      50,
    );
    expect(run.recall).toBeNull(); // no SCORED must_find case
    expect(run.precision).toBeNull(); // no findings at all
    expect(run.citation_accuracy).toBeNull();
    expect(run.cases_errored).toBe(1);
    expect(run.traces_total).toBe(2);
    expect(run.traces_passed).toBe(1);
    expect(run.cost_usd).toBeNull(); // an errored case has unknown cost
  });
});

describe('metricsOverCases / metricDeltas / caseTransitions', () => {
  const base = { groundingKept: 1, groundingTotal: 1, durationMs: 1, costUsd: null };
  const older = scoreRun(
    [
      scoreCase({ caseId: 'a', name: 'a', expectation: mustFind, findings: [], ...base }),
      scoreCase({ caseId: 'b', name: 'b', expectation: { ...mustFind, file: 'src/b.ts' }, findings: [finding('src/b.ts', 12, 12)], ...base }),
    ],
    1,
  );
  const newer = scoreRun(
    [
      scoreCase({ caseId: 'a', name: 'a', expectation: mustFind, findings: [finding('src/config.ts', 12, 12)], ...base }),
      scoreCase({ caseId: 'z', name: 'z', expectation: mustFind, findings: [], ...base }),
    ],
    1,
  );

  it('recomputes over the common subset so changed case sets compare apples-to-apples', () => {
    const common = new Set(['a']);
    const a = metricsOverCases(older, common);
    const b = metricsOverCases(newer, common);
    expect(a.recall).toBe(0);
    expect(b.recall).toBe(1);
    expect(metricDeltas(a, b).recall).toBe(1);
  });

  it('lists only cases scored in both runs whose pass flipped', () => {
    expect(caseTransitions(older, newer)).toEqual([{ case_id: 'a', name: 'a', from: false, to: true }]);
  });
});
