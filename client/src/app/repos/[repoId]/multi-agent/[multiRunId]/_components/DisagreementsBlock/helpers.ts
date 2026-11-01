/** Pure helpers for DisagreementsBlock. */
import type { Conflict } from "@devdigest/shared";

/** "file:12" or "file:12-15" when the location spans several lines. */
export function locationLabel(c: Pick<Conflict, "file" | "line" | "end_line">): string {
  return c.end_line > c.line ? `${c.file}:${c.line}-${c.end_line}` : `${c.file}:${c.line}`;
}
