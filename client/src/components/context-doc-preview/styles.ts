import type { CSSProperties } from "react";

export const s = {
  body: { maxHeight: "60vh", overflow: "auto", fontSize: 13.5, lineHeight: 1.55 } satisfies CSSProperties,
  subtitle: { display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
