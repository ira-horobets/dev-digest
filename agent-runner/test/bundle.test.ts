import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
// @ts-expect-error build.mjs is plain JS
import { buildOptions } from '../build.mjs';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

describe('committed bundle', () => {
  it('equals a fresh build (rebuild with `npm run build` when sources change)', async () => {
    const out = await build({ ...buildOptions, write: false });
    const fresh = out.outputFiles![0]!.text;
    const committed = await readFile(dist, 'utf8');
    expect(committed === fresh).toBe(true);
  });

  it('carries the template version header and no review-action reference (AC-12)', async () => {
    const text = await readFile(dist, 'utf8');
    expect(text.split('\n').slice(0, 3).join('\n')).toContain('devdigest-ci/v1');
    expect(text).not.toContain('devdigest/review-action');
  });
});
