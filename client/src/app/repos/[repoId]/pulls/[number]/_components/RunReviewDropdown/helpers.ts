/** Pure helpers for RunReviewDropdown. */

interface PickableAgent {
  id: string;
  enabled: boolean;
}

/** The agents selected when the menu opens: every enabled one. */
export function defaultSelection(agents: PickableAgent[]): string[] {
  return agents.filter((a) => a.enabled).map((a) => a.id);
}

/** Add `id` to the selection, or remove it when present. */
export function toggleId(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}
