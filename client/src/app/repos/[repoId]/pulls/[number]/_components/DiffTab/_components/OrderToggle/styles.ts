import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
  } satisfies CSSProperties,
} as const;
