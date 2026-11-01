import type { CSSProperties } from "react";

/** Co-located styles for ConfigureRunView. Colors come from CSS variables only. */
export const s = {
  /** The design centres one narrow column, header included. */
  column: { maxWidth: 800, margin: "0 auto" } satisfies CSSProperties,
  page: { display: "flex", flexDirection: "column", gap: 28 } satisfies CSSProperties,
  warning: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-hover)",
    color: "var(--warn)",
    fontSize: 13,
  } satisfies CSSProperties,
} as const;
