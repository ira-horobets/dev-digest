import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildZip, isDirty, looksLikeSecret, toggleInOrder, validateYaml, withEditedWorkflow } from "./helpers";

describe("wizard helpers", () => {
  it("validateYaml accepts a mapping and reports a parse error", () => {
    expect(validateYaml("on: push\njobs: {}\n")).toBeNull();
    expect(validateYaml("a: [1, 2\n")).toBeTruthy();
    expect(validateYaml("just text")).toBeTruthy();
  });

  it("looksLikeSecret flags key-like text but not a secrets reference", () => {
    expect(looksLikeSecret("key: sk-or-v1-abcdef123456")).toBe(true);
    expect(looksLikeSecret("token: ghp_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(looksLikeSecret("OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}")).toBe(false);
  });

  it("buildZip contains exactly the previewed files, with the edited workflow (AC-34)", () => {
    const files = [
      { path: ".devdigest/memory.jsonl", contents: "", editable: false },
      { path: ".github/workflows/devdigest-review.yml", contents: "old", editable: true },
    ];
    const shown = withEditedWorkflow(files, ".github/workflows/devdigest-review.yml", "edited: true\n");
    const out = unzipSync(buildZip(shown));
    expect(Object.keys(out).sort()).toEqual(files.map((f) => f.path).sort());
    expect(strFromU8(out[".github/workflows/devdigest-review.yml"]!)).toBe("edited: true\n");
    expect(withEditedWorkflow(files, ".github/workflows/devdigest-review.yml", null)).toBe(files);
  });

  it("isDirty and toggleInOrder", () => {
    expect(isDirty(null, "x")).toBe(false);
    expect(isDirty("x", "x")).toBe(false);
    expect(isDirty("y", "x")).toBe(true);
    const all = ["opened", "synchronize", "reopened"] as const;
    expect(toggleInOrder(["opened", "synchronize"], "reopened", all)).toEqual(["opened", "synchronize", "reopened"]);
    expect(toggleInOrder(["opened", "synchronize"], "opened", all)).toEqual(["synchronize"]);
  });
});
