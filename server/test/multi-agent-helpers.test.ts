/** multi-agent pure helpers: grouping, conflicts, parent aggregation, estimates. */
import { describe, expect, it } from 'vitest';
import { aggregateParent, buildMultiAgentRun, toColumn, toEstimate } from '../src/modules/multi-agent/helpers.js';
import type { ChildRun, MultiRunData } from '../src/modules/multi-agent/ports.js';
import { child, finding } from './helpers/multi-agent.js';

const run = (children: ChildRun[], tolerance = 3) =>
  buildMultiAgentRun(
    { parent: { id: 'm', prId: 'p', prNumber: 1, ranAt: '2026-10-31T00:00:00.000Z' }, children } satisfies MultiRunData,
    tolerance,
  );

describe('grouping (AC-31)', () => {
  it('overlapping ranges share a location', () => {
    const r = run([child(1, { findings: [finding('a', 'x.ts', 10, 20)] }), child(2, { findings: [finding('b', 'x.ts', 15, 16)] })]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ file: 'x.ts', line: 10, end_line: 20 });
  });

  it('starts within 3 lines group; 4 apart split; other file splits', () => {
    const near = run([child(1, { findings: [finding('a', 'x.ts', 10, 10)] }), child(2, { findings: [finding('b', 'x.ts', 13, 13)] })]);
    expect(near.conflicts).toHaveLength(1);
    const far = run([child(1, { findings: [finding('a', 'x.ts', 10, 10)] }), child(2, { findings: [finding('b', 'x.ts', 14, 14)] })]);
    expect(far.conflicts).toHaveLength(2);
    const other = run([child(1, { findings: [finding('a', 'x.ts', 10, 10)] }), child(2, { findings: [finding('b', 'y.ts', 10, 10)] })]);
    expect(other.conflicts).toHaveLength(2);
  });

  it('is deterministic under a shuffled input order', () => {
    const fs1 = [finding('a', 'x.ts', 1, 1), finding('b', 'x.ts', 2, 2), finding('c', 'y.ts', 5, 5)];
    const fs2 = [finding('d', 'x.ts', 3, 3), finding('e', 'y.ts', 40, 40)];
    const a = run([child(1, { findings: fs1 }), child(2, { findings: fs2 })]);
    const b = run([child(1, { findings: [...fs1].reverse() }), child(2, { findings: [...fs2].reverse() })]);
    expect(b.conflicts).toEqual(a.conflicts);
  });

  it('the same agent twice in one group keeps its highest severity and that title', () => {
    const r = run([
      child(1, { findings: [finding('a', 'x.ts', 1, 1, 'SUGGESTION', 'minor'), finding('b', 'x.ts', 2, 2, 'CRITICAL', 'major')] }),
      child(2, { findings: [finding('c', 'x.ts', 1, 1, 'CRITICAL', 'other')] }),
    ]);
    expect(r.conflicts).toHaveLength(1);
    const take = r.conflicts[0]!.takes[0]!;
    expect(take).toMatchObject({ verdict: 'CRITICAL', note: 'major' });
    expect(r.conflicts[0]!.conflict).toBe(false);
  });
});

describe('conflicts (AC-33, AC-36)', () => {
  it('flagged by one and silent in a completed other = conflict', () => {
    const r = run([child(1, { findings: [finding('a', 'x.ts', 1, 1)] }), child(2)]);
    expect(r.conflicts[0]!.conflict).toBe(true);
    expect(r.conflicts[0]!.takes.map((t) => t.verdict)).toEqual(['WARNING', 'ignored']);
  });

  it('divergent severities = conflict', () => {
    const r = run([child(1, { findings: [finding('a', 'x.ts', 1, 1, 'CRITICAL')] }), child(2, { findings: [finding('b', 'x.ts', 1, 1, 'SUGGESTION')] })]);
    expect(r.conflicts[0]!.conflict).toBe(true);
  });

  it('all agree = no conflict', () => {
    const r = run([child(1, { findings: [finding('a', 'x.ts', 1, 1)] }), child(2, { findings: [finding('b', 'x.ts', 1, 1)] })]);
    expect(r.conflicts[0]!.conflict).toBe(false);
  });

  it('failed, cancelled and running agents are no_result, never ignored, and do not make a conflict', () => {
    const r = run([
      child(1, { findings: [finding('a', 'x.ts', 1, 1)] }),
      child(2, { status: 'failed', error: 'x' }),
      child(3, { status: 'cancelled' }),
      child(4, { status: 'running', durationMs: null, costUsd: null }),
    ]);
    expect(r.conflicts[0]!.takes.map((t) => t.verdict)).toEqual(['WARNING', 'no_result', 'no_result', 'no_result']);
    expect(r.conflicts[0]!.conflict).toBe(false);
  });
});

describe('columns and parent (AC-6)', () => {
  it('maps status, error and a deleted agent', () => {
    const col = toColumn(child(1, { status: 'failed', error: 'bad', agentId: null, agentName: null }));
    expect(col).toMatchObject({ status: 'failed', error: 'bad', agent_id: null, agent_name: 'Deleted agent' });
    expect(toColumn(child(1, { status: null })).status).toBe('running');
    expect(toColumn(child(1)).error).toBeNull();
  });

  it('aggregates status, longest duration and the sum of known costs', () => {
    const cols = (cs: ChildRun[]) => cs.map(toColumn);
    expect(aggregateParent(cols([child(1), child(2, { status: 'running', durationMs: null, costUsd: null })])).status).toBe('running');
    expect(aggregateParent(cols([child(1, { status: 'failed' }), child(2, { status: 'cancelled' })])).status).toBe('failed');
    const done = aggregateParent(cols([child(1), child(2, { status: 'failed', costUsd: null }), child(3)]));
    expect(done).toMatchObject({ status: 'done', totalDurationMs: 3000 });
    expect(done.totalCostUsd).toBeCloseTo(0.04);
    expect(aggregateParent(cols([child(1, { costUsd: null })])).totalCostUsd).toBeNull();
  });
});

describe('toEstimate (AC-8, AC-9)', () => {
  it('averages and counts; nulls without samples', () => {
    expect(
      toEstimate('a', [
        { agentId: 'a', durationMs: 1000, costUsd: 0.1 },
        { agentId: 'a', durationMs: 2000, costUsd: null },
      ]),
    ).toEqual({ agent_id: 'a', duration_ms: 1500, cost_usd: 0.1, samples: 2 });
    expect(toEstimate('a', [])).toEqual({ agent_id: 'a', duration_ms: null, cost_usd: null, samples: 0 });
  });
});
