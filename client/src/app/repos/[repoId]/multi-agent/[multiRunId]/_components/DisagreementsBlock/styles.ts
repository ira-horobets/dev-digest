import type { CSSProperties } from "react";

/** Narrowest an agent cell gets before the cells wrap to a new line. */
const CELL_MIN_WIDTH = 150;

export const s = {
  block: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } satisfies CSSProperties,
  title: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toggleLabel: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  card: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  codeIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  loc: { color: "var(--text-primary)", fontSize: 12.5 } satisfies CSSProperties,
  topic: { color: "var(--text-primary)", fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  /** Cells share the row and wrap when narrow; the card's overflow clips the outer dividers. */
  cells: { display: "flex", flexWrap: "wrap" } satisfies CSSProperties,
  /** Dividers are drawn as right and bottom shadows so a wrapped row leaves no empty tiles. */
  cell: {
    flex: `1 1 ${CELL_MIN_WIDTH}px`,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    minWidth: 0,
    boxShadow: "1px 0 0 var(--border), 0 1px 0 var(--border)",
  } satisfies CSSProperties,
  agent: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  /** A flagged severity reads as an upper-case label; "did not flag" / "no result" stay plain. */
  verdict: (color: string, flagged: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: flagged ? 700 : 400,
    letterSpacing: flagged ? "0.04em" : undefined,
    textTransform: flagged ? "uppercase" : undefined,
    color,
  }),
  dot: (color: string): CSSProperties => ({ width: 7, height: 7, borderRadius: 99, background: color, flexShrink: 0 }),
  cellNote: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 } satisfies CSSProperties,
  more: { alignSelf: "flex-start" } satisfies CSSProperties,
} as const;
