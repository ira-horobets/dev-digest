import { describe, it, expect } from 'vitest';
import { isExpectationGrounded, slugify, synthesizeFrozenDiff } from '../src/modules/eval/frozen-input.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const PATCH = `@@ -9,6 +9,10 @@ export const config = {
   port: 3000,
   host: "0.0.0.0",
   logLevel: "info",
+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",
+  rateLimitMax: 100,
+  rateLimitWindowMs: 60000,
+  rateLimitEnabled: true,
   cors: true,
   trustProxy: true,
   timeoutMs: 30000,`;

describe('synthesizeFrozenDiff', () => {
  it('wraps a hunks-only pr_files.patch so the shared parser keys the file', () => {
    const frozen = synthesizeFrozenDiff('src/config.ts', PATCH);
    const parsed = parseUnifiedDiff(frozen);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.path).toBe('src/config.ts');
    expect(parsed.files[0]!.hunks[0]!.newLineNumbers).toContain(12);
  });
});

describe('isExpectationGrounded', () => {
  const frozen = synthesizeFrozenDiff('src/config.ts', PATCH);
  const exp = { type: 'must_find' as const, file: 'src/config.ts', start_line: 12, end_line: 12 };

  it('accepts an expectation inside a hunk', () => {
    expect(isExpectationGrounded(frozen, exp)).toBe(true);
  });
  it('refuses lines outside every hunk', () => {
    expect(isExpectationGrounded(frozen, { ...exp, start_line: 80, end_line: 82 })).toBe(false);
  });
  it('refuses a file the frozen diff does not contain', () => {
    expect(isExpectationGrounded(frozen, { ...exp, file: 'src/other.ts' })).toBe(false);
  });
});

describe('slugify', () => {
  it('turns a finding title into a case name', () => {
    expect(slugify('Hardcoded Stripe secret key in commit')).toBe('hardcoded-stripe-secret-key-in-commit');
    expect(slugify('!!!')).toBe('eval-case');
  });
});
