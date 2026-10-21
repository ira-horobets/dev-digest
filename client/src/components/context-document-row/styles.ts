import type { CSSProperties } from "react";

/** Co-located styles for ContextDocumentRow. */
export const s = {
  row: (checked: boolean, selected: boolean, dragging: boolean, clickable: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${selected ? "var(--accent)" : checked ? "var(--border-strong)" : "var(--border)"}`,
    background: dragging || selected ? "var(--bg-hover)" : "var(--bg-surface)",
    cursor: clickable ? "pointer" : "default",
    textAlign: "left",
    width: "100%",
    color: "inherit",
    font: "inherit",
  }),
  grip: (active: boolean): CSSProperties => ({
    color: active ? "var(--text-secondary)" : "var(--text-muted)",
    cursor: active ? "grab" : "default",
    display: "inline-flex",
  }),
  path: { flex: 1, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  modifiedDot: { width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  usage: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  arrows: { display: "flex", gap: 2 } satisfies CSSProperties,
} as const;
