import type { CSSProperties } from "react";

/** Co-located styles for CiTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 18, padding: "20px 0", maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  heading: { margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  sub: { margin: "2px 0 0", fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  failOn: { maxWidth: 320 } satisfies CSSProperties,
  list: { margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  addRow: {
    border: "1.5px dashed var(--border-strong)",
    borderRadius: 10,
    padding: "12px 14px",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
} as const;
