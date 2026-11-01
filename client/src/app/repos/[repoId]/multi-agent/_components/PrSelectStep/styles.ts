import type { CSSProperties } from "react";

/** Co-located styles for PrSelectStep. Colors come from CSS variables only. */
export const s = {
  step: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  /** Content sits under the title, indented past the step badge. */
  body: { paddingLeft: 36 } satisfies CSSProperties,
  select: { maxWidth: 440 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
