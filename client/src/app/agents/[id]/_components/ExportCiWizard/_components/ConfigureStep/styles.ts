import type { CSSProperties } from "react";

/** Co-located styles for ConfigureStep. */
export const s = {
  col: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  alert: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-secondary)", marginTop: 8 } satisfies CSSProperties,
  box: { border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  heading: { margin: 0, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  secrets: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  secretRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } satisfies CSSProperties,
  info: { fontSize: 13, color: "var(--text-primary)", background: "var(--info-bg)", borderRadius: 8, padding: "10px 12px" } satisfies CSSProperties,
} as const;
