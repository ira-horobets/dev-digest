/** Pure helpers for TabsView. */

/** Index of the tab a key press moves to, or null when the key is not a tab key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
