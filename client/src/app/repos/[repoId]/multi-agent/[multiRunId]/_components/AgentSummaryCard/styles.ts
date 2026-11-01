import type { CSSProperties } from "react";

export const s = {
  card: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  verdict: { fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 } satisfies CSSProperties,
  summary: { fontSize: 14, color: "var(--text-primary)", margin: 0 } satisfies CSSProperties,
  muted: { fontSize: 14, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  stats: { display: "flex", gap: 12, alignItems: "center", fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
