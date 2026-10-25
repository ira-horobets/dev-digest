import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * SPEC-04 — mechanical check that the two `vendor/shared` copies of the eval
 * contracts agree. `client/src/vendor/shared` is a COPY of the server tree,
 * not a symlink, and both copies carry pre-existing drift elsewhere
 * (`openrouter`, `AgentVersion*`, `AgentManifest`), so only the Eval regions
 * between the section markers are compared. A change to one copy without the
 * other fails here, before it fails in the browser.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const serverContracts = path.resolve(here, '../src/vendor/shared/contracts');
const clientContracts = path.resolve(here, '../../client/src/vendor/shared/contracts');

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

/** Text from `startMarker` up to (excluding) `endMarker`. */
function between(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  if (end === -1) throw new Error(`marker not found: ${endMarker}`);
  return text.slice(start, end);
}

describe('vendor/shared contract parity (eval)', () => {
  it('knowledge.ts: the Eval region is byte-identical in both copies', () => {
    const server = between(read(serverContracts, 'knowledge.ts'), '// ---- Eval ----', '// ---- Memory ----');
    const client = between(read(clientContracts, 'knowledge.ts'), '// ---- Eval ----', '// ---- Memory ----');
    expect(client).toBe(server);
  });

  it('eval-ci.ts: the Eval region is byte-identical in both copies', () => {
    const start = '// Eval — case input';
    const end = '// Compose Review';
    const server = between(read(serverContracts, 'eval-ci.ts'), start, end);
    const client = between(read(clientContracts, 'eval-ci.ts'), start, end);
    expect(client).toBe(server);
  });

  it('both copies export the same eval contract names', () => {
    const names = (text: string) => [...text.matchAll(/^export const (Eval\w+)/gm)].map((m) => m[1]).sort();
    for (const file of ['knowledge.ts', 'eval-ci.ts']) {
      expect(names(read(clientContracts, file))).toEqual(names(read(serverContracts, file)));
    }
  });
});
