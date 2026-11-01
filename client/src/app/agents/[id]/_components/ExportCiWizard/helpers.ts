/* Pure helpers of the Export to CI wizard. */
import { parse } from "yaml";
import { zipSync, strToU8 } from "fflate";
import type { CiFile } from "@devdigest/shared";

/** Error text when `text` is not a valid YAML mapping, else null. */
export function validateYaml(text: string): string | null {
  try {
    const doc = parse(text);
    if (doc === null || typeof doc !== "object") return "the workflow must be a YAML mapping";
    return null;
  } catch (err) {
    return err instanceof Error ? (err.message.split("\n")[0] ?? "invalid YAML") : "invalid YAML";
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-or-v1-[A-Za-z0-9]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /(?:key|token|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9+/_-]{32,}/i,
];

/** Does `text` look like it contains an API key? (Same patterns as the server.) */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/** The files as previewed, with the edited workflow substituted for the generated one. */
export function withEditedWorkflow(files: CiFile[], workflowPath: string, edited: string | null): CiFile[] {
  if (edited === null) return files;
  return files.map((f) => (f.path === workflowPath ? { ...f, contents: edited } : f));
}

/** Zip of exactly these files (paths preserved). */
export function buildZip(files: CiFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = strToU8(f.contents);
  return zipSync(entries);
}

/** Has the user changed the workflow away from the generated text? */
export function isDirty(edited: string | null, generated: string | undefined): boolean {
  return edited !== null && edited !== generated;
}

/** Toggle a value in a list, keeping the canonical order of `all`. */
export function toggleInOrder<T extends string>(list: readonly T[], value: T, all: readonly T[]): T[] {
  const has = list.includes(value);
  return all.filter((v) => (v === value ? !has : list.includes(v)));
}
