import type { CSSProperties } from "react";

/** Co-located styles for StepHeading. Colors come from CSS variables only. */
export const s = {
  row: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  badge: (active: boolean): CSSProperties => ({
    width: 24,
    height: 24,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    background: active ? "var(--accent-bg)" : "var(--bg-hover)",
    color: active ? "var(--accent-text)" : "var(--text-muted)",
  }),
  title: (active: boolean): CSSProperties => ({
    fontSize: 15,
    fontWeight: 600,
    margin: 0,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),
} as const;
