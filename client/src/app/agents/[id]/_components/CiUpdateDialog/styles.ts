import type { CSSProperties } from "react";

/** Co-located styles for CiUpdateDialog. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  text: { margin: 0, fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  list: { margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  item: { listStyle: "none", display: "flex", gap: 10, alignItems: "center", fontSize: 13 } satisfies CSSProperties,
  ok: { color: "var(--ok)", fontSize: 12.5 } satisfies CSSProperties,
  error: { color: "var(--crit)", fontSize: 12.5 } satisfies CSSProperties,
  warning: { fontSize: 13, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 8, padding: "10px 12px" } satisfies CSSProperties,
} as const;
