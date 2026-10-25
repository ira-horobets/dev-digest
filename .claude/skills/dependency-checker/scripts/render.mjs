#!/usr/bin/env node
/**
 * dependency-checker · render.mjs
 *
 * Turns the JSON written by scan.mjs into the Markdown report: Scope, Dependency Graph
 * (Mermaid), Sizes, Findings & Priorities (P0 / P1 / P2 / Info), Summary, Appendix.
 *
 * The output is a complete, deterministic draft. The skill's job after rendering is to verify
 * the top findings against the code and rewrite the Summary as real advice; the markers
 * `<!-- narrative -->` show where that prose goes.
 *
 * Usage:
 *   node render.mjs <scan.json> [--out REPORT.md] [--top 10] [--no-components]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
if (!input) { console.error("usage: render.mjs <scan.json> [--out file] [--top N] [--no-components]"); process.exit(2); }
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i === -1 ? dflt : args[i + 1] ?? true; };
const outFile = flag("out", null);
const TOP = Number(flag("top", 10));
const withComponents = !args.includes("--no-components");

const data = JSON.parse(readFileSync(input, "utf8"));
const L = [];
const p = (...lines) => L.push(...lines);

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

const mb = (n) => (n == null ? "–" : n >= 100 ? `${Math.round(n)} MB` : `${n} MB`);
const short = (name) => name.replace(/^@devdigest\//, "").replace(/^@[^/]+\//, (m) => m);
const id = (s) => "n_" + String(s).replace(/[^A-Za-z0-9]/g, "_");
const esc = (s) => String(s).replace(/"/g, "'").replace(/\|/g, "/");
const cell = (s) => String(s ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (headers, rows) => {
  p(`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`);
  for (const r of rows) p(`| ${r.map(cell).join(" | ")} |`);
  p("");
};
const tierBadge = { P0: "🔴 P0", P1: "🟠 P1", P2: "🟡 P2", Info: "🔵 Info" };
const tierMeaning = {
  P0: "breaks builds or runtime behaviour now, or will on the next install",
  P1: "real cost or risk today: wasted megabytes, drift that bites on upgrade, undeclared imports",
  P2: "worth a ticket: heavy packages, misplaced tooling, duplicates to dedupe",
  Info: "context for maintainers; no action required",
};

const pkgs = data.packages;
const findings = data.findings;
const byTier = (t) => findings.filter((f) => f.tier === t);

// ---------------------------------------------------------------------------------------------
// header
// ---------------------------------------------------------------------------------------------

p(`# Dependency Report — ${basename(data.root)}`, "");
p(`Generated ${data.generatedAt.slice(0, 16).replace("T", " ")} UTC by \`dependency-checker\` (scan ${data.durationMs} ms).`,
  `Packages: **${data.totals.packages}** · declared dependencies: **${data.totals.declared}** · installed on disk: **${mb(data.totals.nodeModulesMb)}** · findings: **${byTier("P0").length} P0 / ${byTier("P1").length} P1 / ${byTier("P2").length} P2 / ${byTier("Info").length} Info**`, "");
p("<!-- narrative: two or three sentences on the overall state of the dependency estate go here -->", "");

// ---------------------------------------------------------------------------------------------
// 1. Scope
// ---------------------------------------------------------------------------------------------

p("## 1. Scope", "");
p(`Repository layout: **${data.cross.workspace}**. Package managers in use: **${data.cross.managers.join(", ")}**.`, "");
table(["Package", "Path", "Manager", "Lockfile", "Prod deps", "Dev deps", "node_modules", "Source files"],
  pkgs.map((k) => [`\`${k.name}\``, `\`${k.dir}\``, k.manager || "none", k.lockfile || "none", k.counts.prod, k.counts.dev, k.nodeModulesInstalled ? mb(k.nodeModulesMb) : "not installed", k.sourceFiles]));
p(`Ignored folders: ${data.options.ignores.map((i) => `\`${i}\``).join(", ")}. Heavy threshold: ${data.options.heavyMb} MB transitive. Registry check for latest versions: ${data.options.outdated ? "on" : "off (pass --outdated to enable)"}.`, "");
p("**Internal vs external.** External dependencies are npm packages resolved from `node_modules`. Internal dependencies are links between this repository's own packages: TypeScript path aliases, `workspace:`/`file:` protocols, relative imports that cross a package boundary, and vendored copies of shared code. They are listed separately in section 2 because they are governed by different rules (no semver, no lockfile, no registry).", "");

// ---------------------------------------------------------------------------------------------
// 2. Graph
// ---------------------------------------------------------------------------------------------

p("## 2. Dependency Graph", "");
p("### 2.1 Packages and internal links", "");
p("Solid arrows are internal links (how one package reaches another). Dashed arrows are the runtime npm packages shared by two or more packages.", "");
p("```mermaid", "flowchart LR");
for (const k of pkgs) p(`  ${id(k.name)}["${esc(short(k.name))}<br/>${k.manager || "no lockfile"} · ${k.counts.prod} prod / ${k.counts.dev} dev<br/>${mb(k.nodeModulesMb)}"]`);
const vendNodes = new Set();
for (const l of data.cross.links) {
  const from = id(l.from);
  if (l.kind === "vendored-copy") {
    const v = id(`vend_${l.via}`);
    if (!vendNodes.has(v)) { vendNodes.add(v); p(`  ${v}[/"vendored copy<br/>${esc(l.via)}"/]`); }
    p(`  ${from} -. "${l.count} imports" .-> ${v}`);
  } else {
    const toId = pkgs.some((k) => k.name === l.to) ? id(l.to) : id(`ext_${l.to}`);
    if (!pkgs.some((k) => k.name === l.to)) p(`  ${toId}["${esc(l.to)}"]`);
    const label = l.kind === "relative-import" ? `relative import ×${l.count} ⚠` : `${l.kind} ${esc(l.via)} ×${l.count}`;
    p(`  ${from} -- "${label}" --> ${toId}`);
  }
}
const sharedProd = data.cross.shared.filter((s) => s.owners.some((o) => o.type === "prod")).slice(0, 8);
for (const s of sharedProd) {
  p(`  ${id(`shared_${s.name}`)}{{"${esc(s.name)}${s.drift !== "none" ? " ⚠ drift" : ""}"}}`);
  for (const o of s.owners.filter((o) => o.type === "prod")) p(`  ${id(o.package)} -.-> ${id(`shared_${s.name}`)}`);
}
for (const k of pkgs) p(`  style ${id(k.name)} fill:#eef3ff,stroke:#3b5bdb`);
for (const v of vendNodes) p(`  style ${v} fill:#fff4e6,stroke:#e8590c`);
p("```", "");

if (data.cross.links.length) {
  table(["From", "Kind", "To", "Via", "Uses", "Target"], data.cross.links.map((l) => [`\`${l.from}\``, l.kind, `\`${l.to}\``, `\`${l.via}\``, l.count, l.target ? `\`${l.target}\`` : "–"]));
} else {
  p("_No internal links between packages were detected._", "");
}

if (withComponents) {
  p("### 2.2 Components inside each package", "");
  p("Nodes are top-level folders of `src/` (modules one level deeper where a folder is a container such as `modules/` or `components/`). Edge labels count import statements. Arrows pointing *into* `platform`/`_shared`-style folders are healthy; arrows *out of* them into feature modules are the ones to question.", "");
  for (const k of pkgs) {
    const c = k.components;
    if (c.nodes.length < 2) { p(`**${k.name}** — fewer than two components with imports between them; nothing to draw.`, ""); continue; }
    // Keep the picture readable: the busiest 20 nodes and the 40 strongest edges between them.
    const nodes = new Set(c.nodes.slice(0, 20));
    const edges = c.edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)).slice(0, 40);
    const hidden = c.nodes.length - nodes.size + c.truncated;
    p(`**${k.name}** (${nodes.size} components, ${edges.length} edges shown${hidden ? `, ${hidden} smaller components hidden` : ""}${c.edges.length > edges.length ? `, ${c.edges.length - edges.length} weaker edges hidden` : ""})`, "");
    p("```mermaid", "flowchart TD");
    for (const n of nodes) p(`  ${id(k.name + n)}["${esc(n)}"]`);
    for (const e of edges) p(`  ${id(k.name + e.from)} -- "${e.count}" --> ${id(k.name + e.to)}`);
    p("```", "");
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Sizes
// ---------------------------------------------------------------------------------------------

p("## 3. Sizes", "");
p("**How to read the numbers.** *Own* is the package's folder alone. *Transitive* is the package plus everything it pulls in, each sub-package counted once per column. Transitive totals of two rows overlap when they share sub-packages, so they do not add up to the `node_modules` total. Front-end libraries are measured as installed, not as bundled: tree-shaking usually ships a fraction of an icon or chart library.", "");

p("### 3.1 Footprint per package", "");
table(["Package", "node_modules", "Files", "Runtime deps (sum of transitive)", "Dev deps (sum of transitive)", "Heaviest runtime dep", "Heaviest dev dep"],
  pkgs.map((k) => {
    const prod = k.deps.filter((d) => d.type === "prod"), dev = k.deps.filter((d) => d.type === "dev");
    const sum = (xs) => Math.round(xs.reduce((a, d) => a + (d.transitiveMb || 0), 0) * 10) / 10;
    const max = (xs) => xs.filter((d) => d.transitiveMb != null).sort((a, b) => b.transitiveMb - a.transitiveMb)[0];
    const mx = (d) => (d ? `${d.name} (${mb(d.transitiveMb)})` : "–");
    return [`\`${k.name}\``, mb(k.nodeModulesMb), k.nodeModulesFiles.toLocaleString("en"), mb(sum(prod)), mb(sum(dev)), mx(max(prod)), mx(max(dev))];
  }));

p("### 3.2 Heaviest dependencies", "");
for (const k of pkgs) {
  const top = k.deps.filter((d) => d.transitiveMb != null).sort((a, b) => b.transitiveMb - a.transitiveMb).slice(0, TOP);
  if (!top.length) continue;
  p(`**${k.name}** — top ${top.length} by transitive size`, "");
  p("```mermaid", "xychart-beta", `  title "${esc(short(k.name))}: transitive MB per dependency"`,
    `  x-axis [${top.map((d) => `"${esc(short(d.name)).slice(0, 22)}"`).join(", ")}]`,
    `  y-axis "MB" 0 --> ${Math.max(1, Math.ceil(top[0].transitiveMb * 1.1))}`,
    `  bar [${top.map((d) => d.transitiveMb).join(", ")}]`, "```", "");
}

p("### 3.3 Every declared dependency", "");
p("*Used by* lists where the scanner found the package referenced: `imports` (source), `scripts` (its bin in package.json scripts), `config` (named in a config file or stylesheet), `peer-of:x` (a declared dependency requires it as a peer), `types-for-declared-dep` (`@types/*` matching a declared package). An empty cell means no reference was found; treat that as a question, not a verdict.", "");
for (const k of pkgs) {
  p(`<details><summary><b>${k.name}</b> — ${k.deps.length} dependencies</summary>`, "");
  table(["Dependency", "Type", "Category", "Declared", "Installed" + (data.options.outdated ? " → latest" : ""), "Own", "Transitive", "Pkgs", "License", "Used by"],
    [...k.deps].sort((a, b) => (b.transitiveMb || 0) - (a.transitiveMb || 0)).map((d) => [
      `\`${d.name}\`${d.native ? " ⚙" : ""}`, d.type, d.category, `\`${d.declared}\``,
      d.installed ? `${d.installed}${d.latest && d.latest !== d.installed ? ` → ${d.latest}` : ""}` : "not installed",
      mb(d.ownMb), mb(d.transitiveMb), d.transitiveCount, d.license || "–", d.usedBy.join(", ") || "**none found**",
    ]));
  p("</details>", "");
}
p("⚙ = ships native binaries.", "");

const dupRows = pkgs.flatMap((k) => k.duplicates.map((d) => [`\`${k.name}\``, `\`${d.name}\``, d.versions.map((v) => `${v.version} (${v.via.slice(0, 2).join(", ")})`).join("<br/>"), d.level, d.viaProd ? "runtime" : "dev only", mb(d.wastedMb)]));
if (dupRows.length) {
  p("### 3.4 Duplicate versions inside one install", "");
  p("The same package installed at more than one version within a package's `node_modules`. *Wasted* is every copy beyond the largest one.", "");
  p(`<details><summary>${dupRows.length} duplicated packages</summary>`, "");
  table(["Package", "Dependency", "Versions (pulled in by)", "Level", "Reach", "Wasted"], dupRows.sort((a, b) => parseFloat(b[5]) - parseFloat(a[5])));
  p("</details>", "");
}

// ---------------------------------------------------------------------------------------------
// 4. Findings & Priorities
// ---------------------------------------------------------------------------------------------

p("## 4. Findings & Priorities", "");
p("Tiers: " + Object.entries(tierMeaning).map(([t, m]) => `**${t}** — ${m}`).join("; ") + ". Within a tier, findings are ordered by the megabytes involved. *Confidence* says how sure the scanner is: `low` findings need a human look before anyone acts on them.", "");
for (const t of ["P0", "P1", "P2", "Info"]) {
  const list = byTier(t);
  p(`### ${tierBadge[t]} (${list.length})`, "");
  if (!list.length) { p("_None._", ""); continue; }
  for (const f of list) {
    p(`- **${f.code}** · \`${f.package}\` › \`${f.subject}\` — ${f.evidence}.`,
      `  → ${f.suggestion}.${f.impactMb ? ` _(${mb(f.impactMb)})_` : ""} _confidence: ${f.confidence}_`);
  }
  p("");
}

// ---------------------------------------------------------------------------------------------
// 5. Summary
// ---------------------------------------------------------------------------------------------

p("## 5. Summary", "");
p("<!-- narrative: replace the draft below with 3–5 takeaways in priority order; each names the package/dependency/file and the concrete next step -->", "");
const seen = new Set();
const draft = findings.filter((f) => f.tier !== "Info" && !seen.has(`${f.code}|${f.subject}`) && seen.add(`${f.code}|${f.subject}`)).slice(0, 5);
if (!draft.length) p("1. No P0–P2 findings. The dependency estate is in good shape; re-run after the next round of upgrades.");
for (const [i, f] of draft.entries()) p(`${i + 1}. **[${f.tier}] ${f.subject}** in \`${f.package}\` — ${f.suggestion}.`);
p("");

// ---------------------------------------------------------------------------------------------
// Appendix
// ---------------------------------------------------------------------------------------------

p("## Appendix", "");
if (data.cross.shared.length) {
  p("### A. Shared external dependencies across packages", "");
  table(["Dependency", "Category", "Declared in", "Ranges", "Installed", "Drift"],
    data.cross.shared.map((s) => [`\`${s.name}\``, s.category, s.owners.map((o) => `${short(o.package)} (${o.type})`).join(", "), s.ranges.map((r) => `\`${r}\``).join(", "), s.installed.join(", "), s.drift === "none" ? (s.rangeDrift ? "ranges differ" : "aligned") : `**${s.drift}**`]));
}
if (data.cross.vendoredCopies.length) {
  p("### B. Vendored copies", "");
  table(["Alias", "Package", "Folder", "Files", "Content hash", "Imports", "Status"],
    data.cross.vendoredCopies.flatMap((v) => v.copies.map((c) => [`\`${v.alias}\``, `\`${c.package}\``, `\`${c.target}\``, c.files, `\`${c.hash}\``, c.imports, v.identical ? "identical" : "**diverged**"])));
}
p("### C. Method and limits", "");
p("- Sizes come from walking the installed `node_modules` (pnpm: through the `.pnpm` store via symlink real paths; npm: nested folders), not from the registry. Numbers are for this machine's install.",
  "- Usage detection is static: `import`/`require` statements, bins named in `package.json` scripts, package names quoted in config files and stylesheets, and peer requirements of other declared dependencies. Dynamic loading by name (plugin systems, `pino` transports, CLI flags) is invisible to it.",
  "- Internal links come from `tsconfig.json` `paths`, `workspace:`/`file:`/`link:` ranges, and relative imports that resolve to an existing file outside the importing package.",
  "- Nothing was modified. Every suggestion is for a human to confirm and apply.", "");

const md = L.join("\n");
if (outFile) { mkdirSync(dirname(resolve(outFile)), { recursive: true }); writeFileSync(outFile, md); console.error(`[render] wrote ${outFile} (${md.split("\n").length} lines)`); }
else process.stdout.write(md);
