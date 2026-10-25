import type { EvalCase, EvalCaseOutcome, EvalExpectation } from "@devdigest/shared";
// VALUE import of the Zod schema: deep path on purpose — the shared barrel
// re-exports with `.js` suffixes the Next bundler cannot resolve (only type
// imports, which are erased, are safe through the barrel).
import { EvalExpectation as EvalExpectationSchema } from "@devdigest/shared/contracts/knowledge";

/** A must_find case expects exactly one matching finding; must_not_flag expects none. */
export function expectedCount(expectation: Pick<EvalExpectation, "type">): number {
  return expectation.type === "must_find" ? 1 : 0;
}

/** Parse the Expected-output editor text into an expectation, or null when invalid. */
export function parseExpectation(text: string): EvalExpectation | null {
  try {
    const parsed = EvalExpectationSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The skeleton the "Finding skeleton" button inserts. */
export function expectationSkeleton(file = "src/config.ts"): string {
  return JSON.stringify(
    {
      type: "must_find",
      file,
      start_line: 12,
      end_line: 12,
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
    },
    null,
    2,
  );
}

/** Pretty-print a case's stored expectation for the editor. */
export function expectationText(evalCase: EvalCase): string {
  return JSON.stringify(evalCase.expectation, null, 2);
}

/** First `+++ b/<path>` in a unified diff, used to prefill the files list. */
export function filesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "").trim();
      if (p && p !== "/dev/null" && !files.includes(p)) files.push(p);
    }
  }
  return files;
}

/** Count passing cases among those with a recorded outcome. */
export function passingCount(cases: EvalCase[], outcomes: Record<string, EvalCaseOutcome>): number {
  return cases.filter((c) => outcomes[c.id]?.pass === true).length;
}
