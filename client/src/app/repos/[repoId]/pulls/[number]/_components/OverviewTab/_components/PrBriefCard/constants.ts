/** PrBriefCard — local literal constants. */

/** Badge colours come from CSS variables only. */
export const STALE_BADGE = { color: "var(--warn)", bg: "var(--warn-bg)" } as const;
export const BLOCKER_BADGE = { color: "var(--crit)", bg: "var(--crit-bg)" } as const;
export const COUNT_BADGE_COLOR = "var(--text-secondary)";

export const SKELETON_HEIGHT = 80;
export const REGENERATE_ICON_SIZE = 28;
export const VERDICT_ICON_SIZE = 18;
export const SCORE_SIZE = 52;
export const SCORE_STROKE = 5;
