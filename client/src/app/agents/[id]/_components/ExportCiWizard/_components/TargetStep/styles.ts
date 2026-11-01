import type { CSSProperties } from "react";

/** Co-located styles for TargetStep. */
export const s = {
  select: {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
  } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
  alert: {
    fontSize: 13,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 8,
    padding: "10px 12px",
  } satisfies CSSProperties,
} as const;
