import type { CSSProperties } from "react";

export const s = {
  page: { display: "flex", flexDirection: "column", gap: 20, padding: "24px 32px" } satisfies CSSProperties,
  skeletons: { display: "flex", flexDirection: "column", gap: 16, padding: "28px 32px" } satisfies CSSProperties,
} as const;
