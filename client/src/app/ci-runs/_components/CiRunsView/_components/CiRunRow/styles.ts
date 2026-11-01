import type { CSSProperties } from "react";

/** Co-located styles for CiRunRow. */
export const s = {
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-primary)", verticalAlign: "top" } satisfies CSSProperties,
  mono: { padding: "8px 10px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)" } satisfies CSSProperties,
  link: { color: "var(--accent)" } satisfies CSSProperties,
  error: { fontSize: 11.5, color: "var(--crit)", marginTop: 4, maxWidth: 260 } satisfies CSSProperties,
} as const;
