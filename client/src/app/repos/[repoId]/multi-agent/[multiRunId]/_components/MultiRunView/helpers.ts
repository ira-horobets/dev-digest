/** Pure helpers for MultiRunView. */

export type ResultsView = "columns" | "tabs";

/** `?view=` → a view; anything but "tabs" falls back to columns. */
export function parseView(value: string | null): ResultsView {
  return value === "tabs" ? "tabs" : "columns";
}
