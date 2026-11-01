import type { CSSProperties } from "react";

/** Co-located styles for FileViewer. */
export const s = {
  wrap: { border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "var(--bg-surface)" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  path: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)", flex: 1, minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  tag: (editable: boolean): CSSProperties => ({
    fontSize: 11,
    padding: "1px 7px",
    borderRadius: 8,
    color: editable ? "var(--accent)" : "var(--text-muted)",
    background: editable ? "var(--accent-bg)" : "var(--bg-hover)",
  }),
  warning: { padding: "6px 10px", fontSize: 12, color: "var(--warn)", background: "var(--warn-bg)" } satisfies CSSProperties,
  body: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    margin: 0,
    padding: 10,
    overflow: "auto",
    border: "none",
    outline: "none",
    resize: "vertical",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    whiteSpace: "pre",
  } satisfies CSSProperties,
} as const;
