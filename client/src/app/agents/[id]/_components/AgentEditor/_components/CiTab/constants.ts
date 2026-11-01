import type { CiFailOn } from "@devdigest/shared";

/** "Fail CI on" options (mirrors the Config tab); labels resolve under `ci.tab.failOnOptions`. */
export const FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];
