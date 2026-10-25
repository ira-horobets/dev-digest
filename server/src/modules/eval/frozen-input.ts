import type { EvalExpectation } from '@devdigest/shared';
import { groundFindings } from '../../platform/grounding.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';

/**
 * Pure helpers for a case's FROZEN input. No I/O, no LLM. Used at creation
 * (from a finding or by hand) and at edit, so a changed expectation is
 * re-validated exactly the same way.
 */

/**
 * A `pr_files.patch` is hunks only (no `diff --git` / `---` / `+++` header),
 * so `parseUnifiedDiff` — which keys files off the `+++ b/<path>` line —
 * cannot parse it standalone. Synthesize the minimal self-contained unified
 * diff around it so the frozen input round-trips through the SAME parser the
 * live review path uses.
 */
export function synthesizeFrozenDiff(path: string, patch: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
}

/**
 * Whether an expectation could EVER be matched: built as a reuse of
 * `groundFindings` (never a second definition of a valid citation). A
 * synthetic `kind: 'finding'` is grounded against the frozen diff; an
 * expectation whose lines fall outside every hunk can never pass, so it is
 * refused at creation/edit with a stated reason.
 */
export function isExpectationGrounded(frozenDiff: string, expectation: EvalExpectation): boolean {
  const diff = parseUnifiedDiff(frozenDiff);
  const synthetic = {
    id: 'eval-expectation-check',
    severity: 'WARNING' as const,
    category: 'bug' as const,
    title: expectation.title ?? 'eval expectation',
    file: expectation.file,
    start_line: expectation.start_line,
    end_line: expectation.end_line,
    rationale: '',
    confidence: 1,
    kind: 'finding' as const,
  };
  return groundFindings([synthetic], diff).kept.length > 0;
}

/** Case name default: a slug of the finding title. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'eval-case';
}
