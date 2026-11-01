import type { CSSProperties } from "react";
import { POPOVER_WIDTH } from "./constants";

/** Co-located styles for RunReviewDropdown. Colors come from CSS variables only. */
export const s = {
  root: { position: "relative", display: "inline-block" } satisfies CSSProperties,
  popover: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    width: POPOVER_WIDTH,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    padding: 8,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 12,
    color: "var(--text-muted)",
    padding: "2px 4px",
  } satisfies CSSProperties,
  link: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent-text)",
    fontSize: 12.5,
    cursor: "pointer",
  } satisfies CSSProperties,
  warning: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontSize: 12,
    color: "var(--warn)",
    padding: "4px",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 280, overflowY: "auto" } satisfies CSSProperties,
  empty: { padding: 8, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    borderTop: "1px solid var(--border)",
    paddingTop: 8,
  } satisfies CSSProperties,
  total: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footerLinks: { display: "flex", justifyContent: "space-between", alignItems: "center" } satisfies CSSProperties,
} as const;
