import { describe, expect, it } from 'vitest';
import { CiResultArtifact, type Review } from '@devdigest/shared';
import { MockGitClient } from '../../server/src/adapters/mocks.js';
import { buildResult } from '../src/result.js';
import { CRITICAL_FINDING, WARNING_FINDING } from './helpers/fixture.js';

const manifest = (ci_fail_on: 'never' | 'critical' | 'warning' | 'any') => ({
  name: 'Agent',
  provider: 'openrouter' as const,
  model: 'm/x',
  system_prompt: 'p',
  skills: [],
  strategy: 'auto' as const,
  ci_fail_on,
});

async function build(findings: unknown[], failOn: 'never' | 'critical' | 'warning' | 'any') {
  const review = { verdict: 'comment', summary: 's', score: 80, findings } as unknown as Review;
  return buildResult({
    review,
    manifest: manifest(failOn),
    diff: await new MockGitClient().diff(),
    costUsd: 0.0123,
    durationMs: 1500.6,
    prNumber: 9,
  });
}

describe('buildResult', () => {
  it('exit code is 1 iff the gate triggers (AC-48)', async () => {
    expect((await build([CRITICAL_FINDING], 'critical')).exitCode).toBe(1);
    expect((await build([WARNING_FINDING], 'critical')).exitCode).toBe(0);
    expect((await build([WARNING_FINDING], 'warning')).exitCode).toBe(1);
    expect((await build([WARNING_FINDING], 'any')).exitCode).toBe(1);
    expect((await build([CRITICAL_FINDING], 'never')).exitCode).toBe(0);
    expect((await build([], 'any')).exitCode).toBe(0);
  });

  it('event is REQUEST_CHANGES only when the gate trips, else COMMENT, never APPROVE (AC-49)', async () => {
    expect((await build([CRITICAL_FINDING], 'critical')).event).toBe('REQUEST_CHANGES');
    expect((await build([WARNING_FINDING], 'critical')).event).toBe('COMMENT');
    const clean = await build([], 'critical');
    expect(clean.event).toBe('COMMENT');
    expect(clean.body).not.toContain('Approved');
  });

  it('artifact parses with CiResultArtifact and carries verdict, blockers, model (AC-50)', async () => {
    const r = await build([CRITICAL_FINDING, WARNING_FINDING], 'warning');
    expect(CiResultArtifact.parse(r.artifact)).toMatchObject({
      findings_count: 2,
      critical: 1,
      warning: 1,
      suggestion: 0,
      verdict: 'request_changes',
      blockers: 2,
      model: 'm/x',
      cost_usd: 0.0123,
      duration_ms: 1501,
      version: 'devdigest-ci/v1',
      pr_number: 9,
    });
  });
});
