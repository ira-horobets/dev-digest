import type { CSSProperties } from "react";

/** Co-located styles for OptionCard. */
export const s = {
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  card: (selected: boolean, disabled: boolean): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 10,
    border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  head: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  tag: {
    fontSize: 11,
    padding: "1px 7px",
    borderRadius: 8,
    color: "var(--accent)",
    background: "var(--accent-bg)",
  } satisfies CSSProperties,
  desc: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  reason: { fontSize: 12, color: "var(--warn)", marginTop: 4 } satisfies CSSProperties,
} as const;
