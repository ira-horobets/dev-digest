import type { CSSProperties } from "react";

type StepState = "done" | "current" | "upcoming";

/** Co-located styles for Stepper. */
export const s = {
  list: { display: "flex", alignItems: "center", gap: 8, listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  item: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  dot: (state: StepState): CSSProperties => ({
    width: 20,
    height: 20,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    fontWeight: 600,
    color: state === "upcoming" ? "var(--text-muted)" : "var(--accent-text)",
    background: state === "done" ? "var(--ok)" : state === "current" ? "var(--accent)" : "var(--bg-hover)",
  }),
  name: (state: StepState): CSSProperties => ({
    fontSize: 13,
    fontWeight: state === "current" ? 600 : 500,
    color: state === "upcoming" ? "var(--text-muted)" : "var(--text-primary)",
  }),
  line: (done: boolean): CSSProperties => ({
    width: 28,
    height: 1,
    background: done ? "var(--ok)" : "var(--border-strong)",
  }),
} as const;
