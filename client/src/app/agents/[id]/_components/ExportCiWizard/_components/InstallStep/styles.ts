import type { CSSProperties } from "react";

/** Co-located styles for InstallStep. */
export const s = {
  link: { fontSize: 13, color: "var(--accent)" } satisfies CSSProperties,
  ok: { fontSize: 13, color: "var(--ok)", background: "var(--ok-bg)", borderRadius: 8, padding: "10px 12px" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", background: "var(--crit-bg)", borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
} as const;
