import type { CSSProperties } from "react";

/** Narrowest a column gets before the row scrolls sideways. */
const COLUMN_MIN_WIDTH = 230;

export const s = {
  row: (count: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(${COLUMN_MIN_WIDTH}px, 1fr))`,
    gap: 12,
    alignItems: "stretch",
    overflowX: "auto",
    paddingBottom: 4,
  }),
} as const;
