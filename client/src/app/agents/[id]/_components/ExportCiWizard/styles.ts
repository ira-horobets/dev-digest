import type { CSSProperties } from "react";

/** Co-located styles for ExportCiWizard (the Modal pads header and footer only). */
export const s = {
  stepper: { padding: "14px 24px 0" } satisfies CSSProperties,
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", minHeight: 280 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  confirmBox: {
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 8,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  confirmActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
