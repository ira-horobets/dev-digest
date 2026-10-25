import { describe, it, expect } from 'vitest';
import { diffLines } from '../src/modules/eval/prompt-diff.js';
import { buildCallout } from '../src/modules/eval/callout.js';
import { scoreRun } from '../src/modules/eval/scoring.js';
import type { EvalCaseOutcome } from '@devdigest/shared';

describe('diffLines', () => {
  it('marks added, removed and context lines (old → new)', () => {
    const old = 'You are a reviewer.\nReturn at most 5 findings.\nCite file and line.';
    const next = 'You are a reviewer.\nReturn at most 5 findings.\nFlag unused imports as suggestions.\nCite file and line.';
    expect(diffLines(old, next)).toEqual([
      { kind: 'context', text: 'You are a reviewer.' },
      { kind: 'context', text: 'Return at most 5 findings.' },
      { kind: 'added', text: 'Flag unused imports as suggestions.' },
      { kind: 'context', text: 'Cite file and line.' },
    ]);
    expect(diffLines('a\nb', 'a\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' },
    ]);
  });
  it('identical prompts produce only context lines', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.kind === 'context')).toBe(true);
  });
});

const outcome = (id: string, type: 'must_find' | 'must_not_flag', pass: boolean, kept = 1, total = 1): EvalCaseOutcome => ({
  case_id: id,
  name: id,
  expectation_type: type,
  status: 'scored',
  pass,
  error_reason: null,
  findings_total: kept,
  findings_matched: type === 'must_find' ? (pass ? 1 : 0) : pass ? 0 : 1,
  grounding_kept: kept,
  grounding_total: total,
  duration_ms: 1,
  cost_usd: 0.01,
  actual: [],
});

describe('buildCallout', () => {
  it('names the metric with the largest move and the cases that flipped', () => {
    const previous = scoreRun([outcome('a', 'must_find', false), outcome('b', 'must_not_flag', true)], 1);
    const latest = scoreRun([outcome('a', 'must_find', true), outcome('b', 'must_not_flag', true)], 1);
    const callout = buildCallout({ metrics: latest, agentVersion: 7 }, { metrics: previous });
    expect(callout).not.toBeNull();
    expect(callout!.metric).toBe('recall');
    expect(callout!.direction).toBe('up');
    expect(callout!.magnitude).toBeCloseTo(1);
    expect(callout!.agent_version).toBe(7);
    expect(callout!.case_transitions).toEqual([{ case_id: 'a', name: 'a', from: false, to: true }]);
  });
  it('reports a precision dip when a dismissed case starts being flagged', () => {
    const previous = scoreRun([outcome('a', 'must_find', true), outcome('b', 'must_not_flag', true, 0, 0)], 1);
    const latest = scoreRun([outcome('a', 'must_find', true), outcome('b', 'must_not_flag', false)], 1);
    const callout = buildCallout({ metrics: latest, agentVersion: 8 }, { metrics: previous });
    expect(callout!.metric).toBe('precision');
    expect(callout!.direction).toBe('down');
  });
  it('is null when nothing is comparable', () => {
    const empty = scoreRun([], 1);
    expect(buildCallout({ metrics: empty, agentVersion: 1 }, { metrics: empty })).toBeNull();
  });
});
