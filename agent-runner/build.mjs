// Bundles the runner into one dependency-free ESM file: dist/index.js (committed).
// `buildOptions` is exported so the stale-bundle test can rebuild in memory.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const buildOptions = {
  absWorkingDir: here,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: false,
  legalComments: 'none',
  logLevel: 'silent',
  banner: {
    js: '#!/usr/bin/env node\n// devdigest-ci/v1 · DevDigest agent-runner · generated, do not edit\nimport { createRequire } from "module"; const require = createRequire(import.meta.url);',
  },
  alias: {
    '@devdigest/reviewer-core': path.join(here, '../reviewer-core/src/index.ts'),
    '@devdigest/shared': path.join(here, '../server/src/vendor/shared/index.ts'),
    zod: path.join(here, 'node_modules/zod'),
  },
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build(buildOptions);
}
