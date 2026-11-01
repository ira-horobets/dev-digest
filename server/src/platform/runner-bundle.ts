/**
 * Loader of the committed CI runner bundle (`agent-runner/dist/index.js`), the
 * file the Export-to-CI wizard writes to `.devdigest/runner/index.js`. A static
 * asset read like `prompts.ts`; cached after the first read.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ConfigError } from './errors.js';

const BUNDLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'agent-runner',
  'dist',
  'index.js',
);
let cached: string | undefined;

export async function loadRunnerBundle(): Promise<string> {
  if (cached !== undefined) return cached;
  try {
    cached = await readFile(BUNDLE_PATH, 'utf8');
  } catch {
    throw new ConfigError('agent-runner bundle missing: run npm run build in agent-runner/');
  }
  return cached;
}
