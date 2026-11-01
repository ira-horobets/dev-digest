import type { CSSProperties } from "react";

export const s = {
  row: { padding: "6px 6px", borderRadius: 6 } satisfies CSSProperties,
  label: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 } satisfies CSSProperties,
  name: { color: "var(--text-primary)", fontWeight: 500, fontSize: 13.5 } satisfies CSSProperties,
  meta: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-muted)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  disabled: { color: "var(--warn)" } satisfies CSSProperties,
} as const;
