import type { CSSProperties } from "react";

/** Co-located styles for PreviewStep. */
export const s = {
  heading: { margin: 0, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", background: "var(--crit-bg)", borderRadius: 8, padding: "10px 12px" } satisfies CSSProperties,
  overwrite: { fontSize: 11, padding: "1px 7px", borderRadius: 8, color: "var(--warn)", background: "var(--warn-bg)" } satisfies CSSProperties,
  overwriteBox: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    fontSize: 13,
    color: "var(--text-primary)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: 12,
  } satisfies CSSProperties,
} as const;
