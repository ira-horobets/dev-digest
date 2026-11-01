import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  tablist: { display: "flex", gap: 4, borderBottom: "1px solid var(--border)", overflowX: "auto" } satisfies CSSProperties,
  tab: (selected: boolean): CSSProperties => ({
    background: "none",
    border: "none",
    borderBottom: `2px solid ${selected ? "var(--accent)" : "transparent"}`,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13.5,
    fontWeight: selected ? 600 : 500,
    color: selected ? "var(--text-primary)" : "var(--text-secondary)",
    whiteSpace: "nowrap",
  }),
  score: { marginLeft: 6, color: "var(--text-muted)" } satisfies CSSProperties,
  panel: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  findings: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
