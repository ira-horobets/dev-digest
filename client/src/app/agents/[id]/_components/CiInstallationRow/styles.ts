import type { CSSProperties } from "react";

/** Co-located styles for CiInstallationRow. */
export const s = {
  row: { listStyle: "none", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", background: "var(--bg-surface)" } satisfies CSSProperties,
  line: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13 } satisfies CSSProperties,
  repo: { fontFamily: "var(--font-mono)", color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
  muted: { color: "var(--text-muted)", fontSize: 12.5 } satisfies CSSProperties,
  mono: { fontFamily: "var(--font-mono)", color: "var(--text-secondary)", fontSize: 12 } satisfies CSSProperties,
  link: { color: "var(--accent)", fontSize: 12.5 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  history: { margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  event: { listStyle: "none", display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 } satisfies CSSProperties,
  error: { color: "var(--crit)" } satisfies CSSProperties,
} as const;
