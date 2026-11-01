import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("formats sub-second, seconds and minutes; unknown is a dash", () => {
    expect(formatDuration(800)).toBe("0.8s");
    expect(formatDuration(8200)).toBe("8s");
    expect(formatDuration(80_000)).toBe("1m 20s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(null)).toBe("—");
  });
});
