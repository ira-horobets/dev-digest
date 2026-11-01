import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { buildFiles, buildMemoryJsonl, buildWorkflow } from '../src/modules/ci/generate.js';
import type { ExportAgent, MemoryRow } from '../src/modules/ci/ports.js';

const agent = (over: Partial<ExportAgent> = {}): ExportAgent => ({
  id: 'a1',
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You review code.\nBe strict: "quotes" and # hashes stay data.',
  strategy: 'auto',
  ciFailOn: 'warning',
  skills: [
    { id: 's1', name: 'OWASP Rules', body: 'Check injection.' },
    { id: 's2', name: 'owasp rules!', body: 'Second body\n' },
  ],
  ...over,
});

const mem = (i: number, content = `item ${i}`): MemoryRow => ({ id: `m${i}`, scope: 'repo', kind: 'fact', content });

const build = (over: Partial<Parameters<typeof buildFiles>[0]> = {}) =>
  buildFiles({
    agent: agent(),
    memoryRows: [mem(1), mem(2)],
    runnerBundle: '#!/usr/bin/env node\n// devdigest-ci/v1\n',
    postAs: 'github_review',
    triggers: ['opened', 'synchronize'],
    ...over,
  });

describe('buildFiles', () => {
  it('lists manifest, one file per skill, memory, runner, workflow in that order (AC-6)', () => {
    const { files } = build();
    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/owasp-rules.md',
      '.devdigest/skills/owasp-rules-2.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);
  });

  it('only the workflow is editable (AC-9)', () => {
    const { files } = build();
    expect(files.filter((f) => f.editable).map((f) => f.path)).toEqual([
      '.github/workflows/devdigest-review.yml',
    ]);
  });

  it('manifest has exactly the seven AgentManifest fields and round-trips (AC-7)', () => {
    const manifest = parse(build().files[0]!.contents);
    expect(Object.keys(manifest)).toEqual([
      'name',
      'provider',
      'model',
      'system_prompt',
      'skills',
      'strategy',
      'ci_fail_on',
    ]);
    const parsed = AgentManifest.parse(manifest);
    expect(parsed.system_prompt).toBe(agent().systemPrompt);
    expect(parsed.skills).toEqual(['owasp-rules', 'owasp-rules-2']);
    expect(parsed.ci_fail_on).toBe('warning');
  });

  it('zero skills and zero memory: no skill files, empty memory file (EC-5)', () => {
    const { files, memory } = build({ agent: agent({ skills: [] }), memoryRows: [] });
    expect(files.some((f) => f.path.startsWith('.devdigest/skills/'))).toBe(false);
    expect(files.find((f) => f.path === '.devdigest/memory.jsonl')!.contents).toBe('');
    expect(memory).toEqual({ included: 0, total: 0, dropped: 0 });
    expect(parse(files[0]!.contents).skills).toEqual([]);
  });
});

describe('buildMemoryJsonl', () => {
  it('writes four fields per line, newest first, no embeddings (AC-8)', () => {
    const out = buildMemoryJsonl([{ ...mem(2), extra: 'x', embedding: [1] } as MemoryRow, mem(1)]);
    const lines = out.contents.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual(['m2', 'm1']);
    expect(Object.keys(lines[0])).toEqual(['id', 'scope', 'kind', 'content']);
    expect(out).toMatchObject({ included: 2, total: 2 });
  });

  it('drops rows whose content looks like a secret and reports the count', () => {
    const out = buildMemoryJsonl([
      mem(1, 'we deploy with token: ghp_abcdefghijklmnopqrstuvwxyz0123'),
      mem(2),
      mem(3, 'key sk-or-v1-abcdef1234567890'),
    ]);
    expect(out).toMatchObject({ included: 1, total: 1, dropped: 2 });
    expect(out.contents).not.toContain('ghp_');
    expect(out.contents).not.toContain('sk-or-v1');
    const built = build({ memoryRows: [mem(1, 'AKIAABCDEFGHIJKLMNOP'), mem(2)] });
    expect(built.memory).toEqual({ included: 1, total: 1, dropped: 1 });
  });

  it('stops at 200 items (EC-6)', () => {
    const rows = Array.from({ length: 201 }, (_, i) => mem(i));
    const out = buildMemoryJsonl(rows);
    expect(out.included).toBe(200);
    expect(out.total).toBe(201);
    expect(out.contents.trim().split('\n')).toHaveLength(200);
  });

  it('stops at the first row that would pass 100 KB', () => {
    const big = 'x'.repeat(40 * 1024);
    const out = buildMemoryJsonl([mem(1, big), mem(2, big), mem(3, big), mem(4, 'tiny')]);
    expect(out.included).toBe(2);
    expect(out.total).toBe(4);
    expect(Buffer.byteLength(out.contents)).toBeLessThanOrEqual(100 * 1024);
  });
});

describe('buildWorkflow', () => {
  const wf = (over: Partial<Parameters<typeof buildWorkflow>[0]> = {}) => {
    const text = buildWorkflow({ postAs: 'github_review', triggers: ['opened', 'synchronize'], agentSlug: 'sec', ...over });
    return { text, doc: parse(text) };
  };

  it('triggers, runner, secrets, artifact and checkout (AC-10)', () => {
    const { doc } = wf({ triggers: ['opened', 'reopened'] });
    expect(doc.on.pull_request.types).toEqual(['opened', 'reopened']);
    const job = doc.jobs.review;
    expect(job['runs-on']).toBe('ubuntu-latest');
    const steps = job.steps as Record<string, any>[];
    expect(steps[0].uses).toBe('actions/checkout@v4');
    expect(steps[1]).toMatchObject({ uses: 'actions/setup-node@v4', with: { 'node-version': '22' } });
    const run = steps.find((s) => s.run);
    expect(run.run).toBe('node .devdigest/runner/index.js');
    expect(run.env).toMatchObject({
      OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
      GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
      DEVDIGEST_AGENT: '.devdigest/agents/sec.yaml',
      DEVDIGEST_POST_AS: 'github_review',
    });
    const upload = steps.find((s) => String(s.uses).startsWith('actions/upload-artifact'));
    expect(upload).toMatchObject({ if: 'always()', with: { name: 'devdigest-result', path: 'devdigest-result.json' } });
  });

  it.each([
    ['github_review', { contents: 'read', 'pull-requests': 'write' }],
    ['pr_comment', { contents: 'read', 'pull-requests': 'write' }],
    ['none', { contents: 'read', 'pull-requests': 'read' }],
  ] as const)('least permissions for %s (AC-11, D9)', (postAs, perms) => {
    const { doc } = wf({ postAs });
    expect(doc.permissions).toEqual(perms);
    expect(doc.jobs.review.steps.find((s: any) => s.run).env.DEVDIGEST_POST_AS).toBe(postAs);
  });

  it('concurrency per PR number with cancel-in-progress (AC-11, EC-11)', () => {
    const { doc } = wf();
    expect(doc.concurrency).toEqual({
      group: 'devdigest-review-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    });
  });

  it('carries the template header and never references the review action (AC-12)', () => {
    const { text } = wf();
    expect(text.split('\n')[0]).toContain('devdigest-ci/v1');
    expect(text).not.toContain('devdigest/review-action');
  });
});
