/** Pure helpers for ConfigureRunView. */
import type { PrMeta } from "@devdigest/shared";

/** Pull requests offered in step 1: open and merged ones (closed-unmerged are left out). */
export function selectablePulls(pulls: PrMeta[] | undefined): PrMeta[] {
  return (pulls ?? []).filter((p) => p.status !== "closed");
}

/** The PR addressed by `?pr=<number>`, looked up across every PR so a closed one still resolves. */
export function pullByNumber(pulls: PrMeta[] | undefined, param: string | null): PrMeta | undefined {
  if (!param) return undefined;
  return (pulls ?? []).find((p) => String(p.number) === param);
}

export function isMergedOrClosed(pr: PrMeta | undefined): boolean {
  return pr?.status === "merged" || pr?.status === "closed";
}

/** The agents selected until the user touches the list: every enabled one. */
export function defaultSelection(agents: { id: string; enabled: boolean }[]): string[] {
  return agents.filter((a) => a.enabled).map((a) => a.id);
}

export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}
