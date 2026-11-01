/** Reads the exported agent: manifest, skill bodies and memory lines. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { RunnerError } from './env.js';

const AGENT_PATH_RE = /^\.devdigest\/agents\/[a-z0-9-]+\.yaml$/;
const SLUG_RE = /^[a-z0-9-]+$/;

export interface LoadedAgent {
  manifest: AgentManifest;
  /** Skill bodies in manifest order. */
  skills: string[];
  /** `content` of each memory line; unreadable lines are skipped. */
  memory: string[];
}

export async function loadAgent(agentPath: string, cwd: string): Promise<LoadedAgent> {
  if (!AGENT_PATH_RE.test(agentPath)) throw new RunnerError('DEVDIGEST_AGENT is not a manifest path');
  let raw: unknown;
  try {
    raw = parse(await readFile(path.join(cwd, agentPath), 'utf8'));
  } catch {
    throw new RunnerError(`Cannot read the agent manifest ${agentPath}`);
  }
  const parsed = AgentManifest.safeParse(raw);
  if (!parsed.success) throw new RunnerError(`Invalid agent manifest ${agentPath}`);
  const manifest = parsed.data;

  const skills: string[] = [];
  for (const slug of manifest.skills) {
    // Paths are built from validated slugs only: no traversal.
    if (!SLUG_RE.test(slug)) throw new RunnerError('Invalid skill slug in the manifest');
    try {
      skills.push(await readFile(path.join(cwd, '.devdigest', 'skills', `${slug}.md`), 'utf8'));
    } catch {
      throw new RunnerError(`Missing skill file .devdigest/skills/${slug}.md`);
    }
  }

  const memory: string[] = [];
  try {
    const text = await readFile(path.join(cwd, '.devdigest', 'memory.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { content?: unknown };
        if (typeof row.content === 'string' && row.content) memory.push(row.content);
      } catch {
        // bad line: skipped
      }
    }
  } catch {
    // no memory file: fine
  }
  return { manifest, skills, memory };
}
