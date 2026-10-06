import { describe, it, expect } from 'vitest';
import { Review } from '@devdigest/shared';
import {
  MockLLMProvider,
  MockGitClient,
  MockGitHubClient,
  MockCodeIndex,
  MockEmbedder,
} from '../src/adapters/mocks.js';
import { assemblePrompt } from '../src/platform/prompt.js';
import { groundFindings } from '../src/platform/grounding.js';
import { estimateCost } from '../src/adapters/llm/pricing.js';

describe('mock adapters (no network)', () => {
  it('MockGitClient.diff parses into hunks with new line numbers', async () => {
    const git = new MockGitClient();
    const diff = await git.diff();
    expect(diff.files[0]!.path).toBe('src/config.ts');
    expect(diff.files[0]!.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
  });

  it('MockGitHubClient records posted reviews and opened PRs', async () => {
    const gh = new MockGitHubClient();
    await gh.postReview({ owner: 'a', name: 'b' }, 482, { body: 'x', event: 'COMMENT' });
    expect(gh.posted).toHaveLength(1);
    const { url } = await gh.openPullRequest({ owner: 'a', name: 'b' }, {
      title: 't',
      head: 'h',
      base: 'main',
      body: 'b',
    });
    expect(url).toContain('github.com');
  });

  it('MockCodeIndex + MockEmbedder return deterministic shapes', async () => {
    const ci = new MockCodeIndex();
    expect((await ci.symbols({ owner: 'a', name: 'b' }))[0]!.name).toBe('rateLimit');
    const emb = await new MockEmbedder().embed(['a', 'b']);
    expect(emb[0]!).toHaveLength(1536);
  });
});

describe('structured review pipeline (mock LLM → grounding)', () => {
  it('runs assemble → completeStructured(Review) → groundFindings end-to-end', async () => {
    // a fixture review where one finding is grounded and one is hallucinated
    const fixture = {
      verdict: 'request_changes',
      summary: 'secret key committed',
      score: 38,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom finding on a line not in the diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'not real',
          confidence: 0.3,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const git = new MockGitClient();
    const diff = await git.diff();

    const { messages } = assemblePrompt({
      system: 'security reviewer',
      diff: diff.raw,
      task: 'Review PR #482',
    });
    const result = await llm.completeStructured({
      model: 'gpt-4.1',
      schema: Review,
      schemaName: 'Review',
      messages,
    });
    expect(result.data.findings).toHaveLength(2);

    const grounded = groundFindings(result.data.findings, diff);
    expect(grounded.kept).toHaveLength(1); // the real one survives
    expect(grounded.kept[0]!.id).toBe('f1');
    expect(grounded.dropped[0]!.finding.id).toBe('f-hallucinated');
    expect(llm.calls.find((c) => c.method === 'completeStructured')).toBeTruthy();
  });
});

describe('pricing / cost discipline', () => {
  it('estimates cost for known models and returns null for unknown', () => {
    expect(estimateCost('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 5);
    expect(estimateCost('some-future-model', 1000, 1000)).toBeNull();
  });
});

describe('GitClient.showFile (sha-pinned read)', () => {
  const repo = { owner: 'o', name: 'r' };

  it('mock clients serve configured files and throw on a missing one', async () => {
    const git = new MockGitClient({ files: { 'a.md': 'hello' } });
    expect(await git.showFile(repo, 'a1b2c3d', 'a.md')).toBe('hello');
    await expect(git.showFile(repo, 'a1b2c3d', 'missing.md')).rejects.toThrow();

    const hub = new MockGitHubClient({ closingIssues: [3], fileContents: { 'b.md': 'x' } });
    expect(await hub.getClosingIssues(repo, 1)).toEqual([3]);
    expect(await hub.getFileContent(repo, 'b.md', 'sha')).toBe('x');
    await expect(hub.getFileContent(repo, 'nope.md', 'sha')).rejects.toThrow();
  });

  it('SimpleGitClient reads the committed blob (not the working tree) and rejects unsafe input', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { simpleGit } = await import('simple-git');
    const { SimpleGitClient } = await import('../src/adapters/git/simple-git.js');

    const root = await mkdtemp(join(tmpdir(), 'showfile-'));
    try {
      const dir = join(root, 'o', 'r');
      await mkdir(dir, { recursive: true });
      const g = simpleGit(dir);
      await g.init();
      await g.addConfig('user.email', 't@t.t');
      await g.addConfig('user.name', 't');
      await writeFile(join(dir, 'plan.md'), 'committed');
      await g.add('plan.md');
      await g.commit('init');
      const sha = (await g.revparse(['HEAD'])).trim();
      await writeFile(join(dir, 'plan.md'), 'edited after commit');

      const client = new SimpleGitClient(root);
      expect(await client.showFile(repo, sha, 'plan.md')).toBe('committed');
      await expect(client.showFile(repo, sha, '../outside.md')).rejects.toThrow(/unsafe path/);
      await expect(client.showFile(repo, sha, '/etc/passwd')).rejects.toThrow(/unsafe path/);
      await expect(client.showFile(repo, sha, '-x.md')).rejects.toThrow(/unsafe path/);
      await expect(client.showFile(repo, '--output=/tmp/x', 'plan.md')).rejects.toThrow(/hex commit sha/);
      await expect(client.showFile(repo, sha, 'missing.md')).rejects.toThrow();

      await writeFile(join(dir, 'big.md'), 'x'.repeat(200_001));
      await g.add('big.md');
      await g.commit('big');
      const sha2 = (await g.revparse(['HEAD'])).trim();
      await expect(client.showFile(repo, sha2, 'big.md')).rejects.toThrow(/size cap/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
