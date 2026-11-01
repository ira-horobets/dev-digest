import type { CSSProperties } from "react";

/** Co-located styles for CiRunsView. */
export const s = {
  page: { padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  h1: { margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  sub: { margin: "2px 0 0", fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  filters: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" } satisfies CSSProperties,
  select: {
    padding: "6px 9px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  toggle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  banner: { fontSize: 13, color: "var(--warn)", background: "var(--warn-bg)", borderRadius: 8, padding: "10px 12px" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: { textAlign: "left", padding: "8px 10px", fontSize: 11.5, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
} as const;
