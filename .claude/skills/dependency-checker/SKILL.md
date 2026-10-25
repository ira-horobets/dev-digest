---
name: dependency-checker
description: "Audit every dependency of a repository and the links between its own packages, then deliver one developer-readable report: a Mermaid graph of packages, internal links and components; a size breakdown (own and transitive MB per package, duplicates, heaviest offenders); a type/category for each dependency; findings tiered P0/P1/P2/Info; and 3–5 prioritised recommendations. Use it whenever someone asks to check, audit, analyse, map, visualise, clean up or slim down dependencies, node_modules, package.json, bundle or install size, unused or duplicated packages, version drift between packages, or how the repo's packages depend on each other — even if they never say 'dependency checker'. Read-only: it recommends, it never edits package.json. Form: /dependency-checker [path] [--outdated] [--heavy-mb N] [--out <file>]."
argument-hint: "[path] [--outdated] [--heavy-mb N] [--out docs/dependencies/REPORT.md]"
allowed-tools:
  - "Bash(node .claude/skills/dependency-checker/scripts/*)"
  - "Bash(node ./.claude/skills/dependency-checker/scripts/*)"
  - "Bash(git diff *)"
  - "Bash(diff *)"
  - "Read"
  - "Grep"
  - "Glob"
  - "Write"
metadata:
  tags: dependencies, node_modules, package.json, size, audit, graph, mermaid, cleanup
---

# dependency-checker — what does this repo depend on, how much does it weigh, what first?

The scripts measure; you judge. `scan.mjs` reads every `package.json`, walks the installed
`node_modules`, scans the source for imports and writes one JSON file. `render.mjs` turns that
into a Markdown report with every table and diagram already in place. Your work is the part a
script cannot do: confirm the findings that matter against the code, explain *why* each one
matters to this team, and turn the list into an order of operations.

The reader is a developer who was not in the room. Every claim names a package, a dependency
or a file, and every recommendation is something they can act on tomorrow.

## What you deliver

One Markdown report, written to `docs/dependencies/REPORT.md` unless the user names another
path (or asks for the answer inline), with exactly these sections:

1. **Scope** — which packages were analysed, where they live, their package manager and
   lockfile, what was ignored, and the internal-vs-external distinction spelled out.
2. **Dependency Graph** — a Mermaid `flowchart` of the packages and the links between them
   (aliases, `workspace:`/`file:` deps, cross-boundary relative imports, vendored copies),
   then one `flowchart` per package of its internal components.
3. **Sizes** — footprint per package, heaviest dependencies (bar chart), a table of every
   declared dependency with type, category, declared vs installed version, own and transitive
   size, license and where it is used, and the duplicate-version table.
4. **Findings & Priorities** — grouped under `P0`, `P1`, `P2`, `Info`, each with evidence, a
   suggested action and a confidence level. Never an unranked bullet list.
5. **Summary** — 3 to 5 takeaways in priority order, each naming the specific thing to do.

The renderer emits all five with the data filled in. See
[references/report-template.md](references/report-template.md) for the skeleton when you must
write it by hand.

## Workflow

### 0. Decide how you will get the data

- **Repository on disk** (the normal case): run the scripts below.
- **Data handed to you in the prompt** (package lists, `du` output, grep results): do not ask
  for tools or more data. Treat the inlined data as the scan output and produce the full
  report from it — see *Working from inlined data* further down.

### 1. Scan

```bash
node .claude/skills/dependency-checker/scripts/scan.mjs --out .pipeline/deps/scan.json
# useful flags: --root <dir>  --ignore extra,folders  --heavy-mb 15  --depth 2  --outdated
```

It takes about a second for a few packages and needs only Node 18+. Add `--outdated` when
the user cares about freshness: it asks the npm registry for the latest version of every
dependency (network, ~10–30 s). Read the `[scan]` lines: a package reported without
`node_modules` has no size data, so install first or say so in Scope.

### 2. Render

```bash
node .claude/skills/dependency-checker/scripts/render.mjs .pipeline/deps/scan.json --out docs/dependencies/REPORT.md
```

Open the result. The `<!-- narrative -->` markers show the two places that still need prose:
the opening paragraph and the Summary.

### 3. Verify before you judge

The scanner is static and says so with a `confidence` on each finding. Before you present a
finding as fact, check the ones a wrong call would embarrass you on:

- **UNUSED_DEPENDENCY** — grep the package once more, including config files, shell scripts
  and strings (`pino` transports, CLI flags, `require.resolve`). If it is used dynamically,
  downgrade to Info and say how it is loaded.
- **CROSS_PACKAGE_RELATIVE_IMPORT** — open the file. A test reaching into a sibling's
  `src/` is still P0 for the maintainer of that sibling, but say which file and suggest the
  entry point it should use instead.
- **VENDORED_COPY_DIVERGED** — `diff -r` the two folders and say what differs (one file? a
  type? everything?) so the reader knows whether it is a sync or a redesign.
- **PHANTOM / UNRESOLVABLE import** — if it only appears in test or fixture text, say so.
- **HEAVY_DEPENDENCY in a front-end package** — installed size is not bundle size. Mention
  tree-shaking and, if useful, the narrower import that avoids the bulk.

Skip this step for Info findings; the table already shows them.

### 4. Write the narrative

Replace the two `<!-- narrative -->` markers:

- **Opening paragraph**: two or three sentences a tech lead could paste into a channel —
  how big the estate is, the one structural fact that explains most findings (mixed package
  managers? a vendored shared folder? one giant SDK?), and what to do first.
- **Summary**: 3–5 numbered takeaways, priority order, each in the shape
  *what* (package › dependency/file) → *do this* → *because* (the number or risk).
  Merge findings that share a fix ("pin `zod` in all three package.json files" is one
  takeaway, not three). Do not list more than one item per tier unless it changes the order.

Recommendations are for the user to confirm. Write "remove `moment` from
`server/package.json` after confirming nothing loads it dynamically", not "removed". Give the
exact command when one exists (`pnpm remove moment`, `pnpm dedupe`, `pnpm overrides`).

### 5. Deliver

Tell the user where the report is, quote the Summary, and mention the one flag that would
make the next run more useful (`--outdated` if it was off). Do not edit `package.json`,
lockfiles or `node_modules` — this skill reports; the user changes.

## Working from inlined data (no tools)

When the prompt already contains the package lists, sizes and grep results, build the same
report by hand, in the same order:

1. **Scope table** from the package names given. State the layout honestly: separate
   lockfiles and path aliases mean *independent packages*, not a workspace — never claim
   `workspace:*` or pnpm workspaces unless the data shows them.
2. **Graph**: packages as nodes; internal links (aliases, relative imports) as solid labelled
   edges; shared runtime libraries as dashed edges to a hexagon node. Keep it one
   ` ```mermaid ` block starting with `flowchart LR`.
3. **Sizes**: a table of every dependency with the size given; mark missing sizes as `–`.
   Rank the heaviest; note transitive overlap if you only have own sizes.
4. **Findings**: walk the rubric in
   [references/severity-rubric.md](references/severity-rubric.md) over the data — unused
   runtime deps, undeclared imports, relative imports into another package, version drift,
   duplicates, tooling in `dependencies`, heavy packages — and tier each one.
5. **Summary** as in step 4 above.

## Severity tiers in one breath

| Tier | Means | Typical codes |
| --- | --- | --- |
| **P0** | breaks now or on the next clean install; two runtime copies of a singleton | `MISSING_LOCKFILE`, `UNRESOLVABLE_IMPORT`, `CROSS_PACKAGE_RELATIVE_IMPORT`, singleton `DUPLICATE_VERSIONS` |
| **P1** | real cost or risk today | `UNUSED_DEPENDENCY` (runtime), `PHANTOM_DEPENDENCY`, major `VERSION_DRIFT`, `VENDORED_COPY_DIVERGED`, ≥ 5 MB runtime duplicates, copyleft license |
| **P2** | worth a ticket this quarter | `HEAVY_DEPENDENCY`, `TOOLING_IN_PROD`, minor drift, 1–5 MB duplicates, `OUTDATED_MAJOR`, identical vendored copies |
| **Info** | context, no action required | unreferenced dev deps, dev-only drift, native modules, mixed managers, small duplicates |

The full rubric, with the reasoning per code and the promotion/demotion rules, is in
[references/severity-rubric.md](references/severity-rubric.md). Categories (framework, ui,
data, testing …), the kinds of internal link and the size bands are in
[references/dependency-types.md](references/dependency-types.md).

## Rules that keep the report honest

- **Internal and external are different things.** An alias into a sibling's `src/` has no
  semver, no lockfile and no registry; a relative import across a package boundary couples
  two packages to each other's file layout. Report them in their own table and diagram, and
  never fold them into the npm list.
- **Sizes are installed sizes on this machine**, measured by walking `node_modules`
  (through pnpm's `.pnpm` store via real paths). Transitive totals overlap between rows.
  Say this once in section 3 and do not sum rows as if they were disjoint.
- **"No reference found" is a question, not a verdict.** Peer requirements, bins in
  scripts, names quoted in config and `@import "pkg"` in CSS all count as use; dynamic
  loading does not show up at all.
- **Name the thing.** "Consider optimising dependencies" is not a finding. "`server/package.json`
  declares `moment` (4.2 MB) and nothing under `server/src` imports it" is.
- **English only**, like every other artifact in this repository, whatever language the
  request came in.

## Options

| Flag | Default | Effect |
| --- | --- | --- |
| `--root <dir>` | git top-level or cwd | where to look for `package.json` files |
| `--ignore a,b` | – | extra folder names to skip (always skipped: `node_modules`, `.git`, `.next`, `dist`, `build`, `out`, `coverage`, `clones`, `.pipeline`, …) |
| `--heavy-mb N` | 15 | transitive MB from which a runtime dependency is flagged `HEAVY_DEPENDENCY` |
| `--depth N` | 2 | folder depth under `src/` used for component nodes |
| `--outdated` | off | query the npm registry for latest versions |
| `--out <file>` | stdout | where to write JSON (scan) or Markdown (render) |
| `--top N` (render) | 10 | bars in the heaviest-dependencies chart |
| `--no-components` (render) | – | skip the per-package component diagrams |

## Files

```
dependency-checker/
├── SKILL.md                       this file
├── scripts/scan.mjs               repo → scan.json (packages, deps, sizes, links, findings)
├── scripts/render.mjs             scan.json → REPORT.md (tables, Mermaid, tiers, draft summary)
└── references/
    ├── severity-rubric.md         every finding code, its tier and the reasoning
    ├── dependency-types.md        categories, internal link kinds, size bands
    └── report-template.md         the five-section skeleton for hand-written reports
```
