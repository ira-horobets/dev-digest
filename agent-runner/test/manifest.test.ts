import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentManifest } from '@devdigest/shared';
import { stringify } from 'yaml';
import { loadAgent } from '../src/manifest.js';
import { makeWorkDir } from './helpers/fixture.js';

describe('loadAgent', () => {
  it('reads the manifest, skill bodies and memory content, skipping bad lines', async () => {
    const w = await makeWorkDir({ skills: { 'a-rule': 'A body\n', 'b-rule': 'B body\n' } });
    const a = await loadAgent(w.env.DEVDIGEST_AGENT!, w.cwd);
    expect(a.manifest.name).toBe('Test agent');
    expect(a.manifest.skills).toEqual(['a-rule', 'b-rule']);
    expect(a.skills).toEqual(['A body\n', 'B body\n']);
    expect(a.memory).toEqual(['We use Postgres.']);
  });

  it('round-trips what the studio writes (yaml stringify of the seven fields)', async () => {
    const w = await makeWorkDir();
    const manifest = {
      name: 'X',
      provider: 'openrouter',
      model: 'm',
      system_prompt: 'multi\nline: with "quotes"\n',
      skills: [],
      strategy: 'auto',
      ci_fail_on: 'warning',
    };
    await writeFile(path.join(w.cwd, '.devdigest', 'agents', 'x.yaml'), stringify(manifest, { lineWidth: 0 }));
    const a = await loadAgent('.devdigest/agents/x.yaml', w.cwd);
    expect(a.manifest).toEqual(AgentManifest.parse(manifest));
  });

  it('rejects a manifest path outside .devdigest/agents', async () => {
    const w = await makeWorkDir();
    await expect(loadAgent('../../etc/passwd', w.cwd)).rejects.toThrow(/manifest path/);
    await expect(loadAgent('.devdigest/agents/../x.yaml', w.cwd)).rejects.toThrow(/manifest path/);
  });

  it('rejects skill slugs that could traverse', async () => {
    const w = await makeWorkDir();
    await mkdir(path.join(w.cwd, '.devdigest', 'agents'), { recursive: true });
    await writeFile(
      path.join(w.cwd, '.devdigest', 'agents', 'bad.yaml'),
      'name: B\nmodel: m\nsystem_prompt: p\nskills:\n  - ../../secret\n',
    );
    await expect(loadAgent('.devdigest/agents/bad.yaml', w.cwd)).rejects.toThrow(/skill slug/);
  });
});
