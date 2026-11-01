import type { CSSProperties } from "react";

/** Co-located styles for EstimateLabel. Colors come from CSS variables only. */
export const s = {
  value: { fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap" } satisfies CSSProperties,
  empty: { fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  partial: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
