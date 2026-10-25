#!/usr/bin/env node
/**
 * dependency-checker · scan.mjs
 *
 * Walks a repository (monorepo, multi-package folder, or single package), reads every
 * package.json it can find, measures what is actually installed in node_modules, scans the
 * source for imports, and writes one JSON document describing:
 *
 *   - packages          each app/library found, its package manager and lockfile
 *   - external deps     declared range, installed version, own size, transitive size + count,
 *                       license, category, where it is used (imports / scripts / config)
 *   - internal links    tsconfig path aliases, workspace:/file: deps, relative imports that
 *                       escape a package, vendored copies of shared code
 *   - components        import graph between the top-level folders of each package's src/
 *   - findings          tiered P0 / P1 / P2 / Info, with evidence and a suggested action
 *
 * No dependencies: plain Node >= 18. Read-only: never touches package.json or node_modules.
 *
 * Usage:
 *   node scan.mjs [--root <dir>] [--out <file.json>] [--ignore a,b,c] [--heavy-mb 15]
 *                 [--depth 2] [--outdated] [--quiet]
 *
 * Pair with render.mjs to turn the JSON into the Markdown report.
 */

import { execFileSync, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};

const DEFAULT_IGNORES = [
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".turbo", ".cache",
  ".pnpm", "clones", "tmp", ".pipeline",
];

const opts = {
  root: resolve(String(flag("root", detectRoot()))),
  out: flag("out", null),
  ignores: new Set([...DEFAULT_IGNORES, ...String(flag("ignore", "")).split(",").filter(Boolean)]),
  heavyMb: Number(flag("heavy-mb", 15)),
  depth: Number(flag("depth", 2)),
  outdated: flag("outdated", false) === true,
  quiet: flag("quiet", false) === true,
};

const log = (...m) => { if (!opts.quiet) console.error("[scan]", ...m); };

function detectRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.cwd();
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const MB = 1024 * 1024;
const toMb = (b) => Math.round((b / MB) * 10) / 10;
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const SRC_EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const CONFIG_EXT = new Set([...SRC_EXT, ".json", ".yaml", ".yml", ".toml", ".css", ".scss"]);
const CONTAINER_DIRS = new Set(["modules", "components", "features", "app", "lib", "routes", "pages", "domains", "packages", "services", "adapters", "platform"]);

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

/** tsconfig files are JSONC: strip comments (outside strings) and trailing commas. */
function stripJsonc(raw) {
  let out = "", i = 0, inStr = false;
  while (i < raw.length) {
    const c = raw[i], n = raw[i + 1];
    if (inStr) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === '"') inStr = false; i += 1; continue; }
    if (c === '"') { inStr = true; out += c; i += 1; continue; }
    if (c === "/" && n === "/") { while (i < raw.length && raw[i] !== "\n") i += 1; continue; }
    if (c === "/" && n === "*") { const end = raw.indexOf("*/", i + 2); i = end === -1 ? raw.length : end + 2; continue; }
    out += c; i += 1;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
function readJsonc(file) {
  try { return JSON.parse(stripJsonc(readFileSync(file, "utf8"))); } catch { return null; }
}

/**
 * Remove comments from source before looking for imports: JSDoc examples such as
 * `import foo from 'x'` are not dependencies. Strings ('', "", ``) are kept intact.
 */
function stripComments(src) {
  let out = "", i = 0, quote = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (quote) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === quote) quote = null; i += 1; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i += 1; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && n === "*") { const end = src.indexOf("*/", i + 2); const skipped = src.slice(i, end === -1 ? src.length : end + 2); out += skipped.replace(/[^\n]/g, ""); i = end === -1 ? src.length : end + 2; continue; }
    out += c; i += 1;
  }
  return out;
}

/** Does a relative import target exist on disk (with the usual extension/index probing)? */
function importTargetExists(abs) {
  const base = abs.replace(/\.(js|mjs|cjs|jsx)$/, "");
  const candidates = [abs, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".json", ".css", ".scss"].map((e) => base + e),
    ...["index.ts", "index.tsx", "index.js", "index.mjs"].map((f) => join(abs, f))];
  return candidates.some((c) => existsSync(c));
}

function walkDirs(dir, visit, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory() && !opts.ignores.has(e.name)) {
      const full = join(dir, e.name);
      if (visit(full, depth) !== false) walkDirs(full, visit, depth + 1);
    }
  }
}

function listSourceFiles(pkgDir, exts) {
  const files = [];
  const rec = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!opts.ignores.has(e.name)) rec(full);
      } else if (e.isFile() && exts.has(extname(e.name))) {
        files.push(full);
      }
    }
  };
  rec(pkgDir);
  return files;
}

/** Bytes under `dir`, not following symlinks. `skipNested` leaves out nested node_modules. */
const sizeCache = new Map();
function dirSize(dir, skipNested = true) {
  const key = `${dir}|${skipNested}`;
  if (sizeCache.has(key)) return sizeCache.get(key);
  let bytes = 0, files = 0, native = false;
  const rec = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (skipNested && e.name === "node_modules") continue;
        rec(full);
      } else if (e.isFile()) {
        files += 1;
        if (e.name.endsWith(".node") || e.name === "binding.gyp") native = true;
        try { bytes += lstatSync(full).size; } catch { /* unreadable */ }
      }
    }
  };
  rec(dir);
  const r = { bytes, files, native };
  sizeCache.set(key, r);
  return r;
}

function specifierToPackage(spec) {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) return null;
  if (BUILTINS.has(spec) || spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function semverParts(v) {
  const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function diffLevel(a, b) {
  const x = semverParts(a), y = semverParts(b);
  if (!x || !y) return "unknown";
  if (x[0] !== y[0]) return "major";
  if (x[1] !== y[1]) return "minor";
  if (x[2] !== y[2]) return "patch";
  return "same";
}

// ---------------------------------------------------------------------------------------------
// Dependency categories (type). Order matters: first match wins.
// ---------------------------------------------------------------------------------------------

const CATEGORY_RULES = [
  ["types", (n) => n.startsWith("@types/")],
  ["testing", (n) => /^(vitest|jest|mocha|chai|@testing-library\/|jsdom|happy-dom|playwright|@playwright\/|testcontainers|@testcontainers\/|supertest|msw|cypress)/.test(n)],
  ["build-tooling", (n) => /^(typescript|tsx|ts-node|esbuild|vite|@vitejs\/|rollup|webpack|swc|@swc\/|babel|@babel\/|eslint|prettier|turbo|nx|tsup|drizzle-kit|prisma$|pino-pretty|nodemon|concurrently|husky|lint-staged)/.test(n)],
  ["framework", (n) => /^(next|react|react-dom|fastify|express|koa|hono|nestjs|@nestjs\/|@fastify\/|fastify-|vue|nuxt|svelte|angular|@angular\/|remix|@remix-run\/)/.test(n)],
  ["ui", (n) => /^(lucide-react|recharts|mermaid|react-markdown|remark-|rehype-|tailwindcss|@tailwindcss\/|postcss|autoprefixer|@radix-ui\/|@headlessui\/|framer-motion|clsx|class-variance-authority|tailwind-merge|next-intl|react-i18next|i18next)/.test(n)],
  ["data", (n) => /^(drizzle-orm|postgres|pg$|pg-|prisma|@prisma\/|mongoose|mongodb|redis|ioredis|knex|typeorm|sequelize|better-sqlite3|sqlite3|mysql2?)/.test(n)],
  ["ai-llm", (n) => /^(openai|@anthropic-ai\/|@google\/generative|langchain|@langchain\/|js-tiktoken|tiktoken|ai$|@ai-sdk\/)/.test(n)],
  ["validation", (n) => /^(zod|yup|joi|ajv|valibot|superstruct|fastify-type-provider-zod)/.test(n)],
  ["git-vcs", (n) => /^(octokit|@octokit\/|simple-git|isomorphic-git|@vscode\/ripgrep)/.test(n)],
  ["code-analysis", (n) => /^(dependency-cruiser|@ast-grep\/|graphology|ts-morph|typescript-eslint|@typescript-eslint\/|madge)/.test(n)],
  ["agent-sdk", (n) => /^(@anthropic-ai\/claude-agent-sdk|@modelcontextprotocol\/)/.test(n)],
  ["utility", (n) => /^(dotenv|p-queue|p-limit|gray-matter|lodash|lodash-es|date-fns|dayjs|moment|luxon|uuid|nanoid|chalk|commander|yargs|minimist|glob|fast-glob|semver|yaml|js-yaml)/.test(n)],
];
function categorize(name) {
  for (const [cat, test] of CATEGORY_RULES) if (test(name)) return cat;
  return "other";
}
const TOOLING_CATEGORIES = new Set(["types", "testing", "build-tooling"]);
const COPYLEFT = /\b(A?GPL|LGPL|SSPL|EUPL|CC-BY-SA)\b/i;
const SINGLETON_LIBS = new Set(["react", "react-dom", "next", "fastify", "drizzle-orm", "zod", "graphology", "vue", "svelte"]);

// ---------------------------------------------------------------------------------------------
// 1. Discover packages
// ---------------------------------------------------------------------------------------------

function discoverPackages(root) {
  const found = [];
  const consider = (dir) => {
    const pj = join(dir, "package.json");
    if (existsSync(pj)) {
      const json = readJson(pj);
      if (json) found.push({ dir, json });
    }
  };
  consider(root);
  walkDirs(root, (dir) => { consider(dir); return true; });
  return found;
}

function detectManager(dir) {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return { manager: "pnpm", lockfile: "pnpm-lock.yaml" };
  if (existsSync(join(dir, "package-lock.json"))) return { manager: "npm", lockfile: "package-lock.json" };
  if (existsSync(join(dir, "yarn.lock"))) return { manager: "yarn", lockfile: "yarn.lock" };
  if (existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"))) return { manager: "bun", lockfile: "bun.lock" };
  return { manager: null, lockfile: null };
}

function detectWorkspace(root, rootJson) {
  if (existsSync(join(root, "pnpm-workspace.yaml"))) return "pnpm-workspace";
  if (rootJson?.workspaces) return "npm/yarn workspaces";
  return "none (independent packages)";
}

// ---------------------------------------------------------------------------------------------
// 2. Installed packages: resolve, size, transitive closure
// ---------------------------------------------------------------------------------------------

const installedCache = new Map(); // realpath -> info

function nearestNodeModulesAncestors(dir) {
  const out = [];
  let d = dir;
  while (true) {
    const parent = dirname(d);
    if (parent === d) break;
    if (basename(parent) === "node_modules") out.push(parent);
    else if (basename(dirname(parent)) === "node_modules" && basename(parent).startsWith("@")) out.push(dirname(parent));
    d = parent;
  }
  return out;
}

/** Resolve dependency `name` as seen from an installed package at `fromReal`. */
function resolveFrom(fromReal, name) {
  const candidates = [join(fromReal, "node_modules", name), ...nearestNodeModulesAncestors(fromReal).map((nm) => join(nm, name))];
  for (const c of candidates) {
    if (existsSync(join(c, "package.json"))) {
      try { return realpathSync(c); } catch { /* dangling */ }
    }
  }
  return null;
}

function installedInfo(realDir) {
  if (installedCache.has(realDir)) return installedCache.get(realDir);
  const json = readJson(join(realDir, "package.json")) || {};
  const size = dirSize(realDir, true);
  const info = {
    real: realDir,
    name: json.name || basename(realDir),
    version: json.version || "?",
    license: typeof json.license === "string" ? json.license : json.license?.type || (Array.isArray(json.licenses) ? json.licenses.map((l) => l.type).join("/") : "?"),
    bin: typeof json.bin === "string" ? [json.name] : Object.keys(json.bin || {}),
    deps: Object.keys(json.dependencies || {}),
    optional: Object.keys(json.optionalDependencies || {}),
    peers: Object.keys(json.peerDependencies || {}),
    ownBytes: size.bytes,
    files: size.files,
    native: size.native || Boolean(json.gypfile) || Boolean(json.cpu) || Boolean(json.os),
  };
  installedCache.set(realDir, info);
  return info;
}

/** Breadth-first closure of runtime deps (+ installed optionals) starting at one package. */
function closureOf(startReal) {
  const seen = new Map([[startReal, installedInfo(startReal)]]);
  const queue = [startReal];
  while (queue.length) {
    const cur = queue.shift();
    const info = seen.get(cur);
    for (const d of [...info.deps, ...info.optional]) {
      const r = resolveFrom(cur, d);
      if (r && !seen.has(r)) { seen.set(r, installedInfo(r)); queue.push(r); }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------
// 3. Source scanning: imports, aliases, component graph
// ---------------------------------------------------------------------------------------------

// Static import/export ... from 'x', dynamic import('x') (also `import('x' as string)`),
// require('x') and require.resolve('x').
const IMPORT_RE = /(?:^|[^\w$])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"\n]+)['"]|(?:^|[^\w$])import\s*\(\s*['"]([^'"\n]+)['"]|(?:^|[^\w$])require(?:\.resolve)?\s*\(\s*['"]([^'"\n]+)['"]/g;

function loadTsconfig(pkgDir) {
  const file = join(pkgDir, "tsconfig.json");
  const cfg = readJsonc(file);
  if (!cfg) return { paths: {}, baseDir: pkgDir };
  let paths = cfg.compilerOptions?.paths || {};
  let baseDir = cfg.compilerOptions?.baseUrl ? resolve(pkgDir, cfg.compilerOptions.baseUrl) : pkgDir;
  if (!Object.keys(paths).length && typeof cfg.extends === "string" && cfg.extends.startsWith(".")) {
    const parent = readJsonc(resolve(pkgDir, cfg.extends));
    if (parent?.compilerOptions?.paths) {
      paths = parent.compilerOptions.paths;
      const pdir = dirname(resolve(pkgDir, cfg.extends));
      baseDir = parent.compilerOptions.baseUrl ? resolve(pdir, parent.compilerOptions.baseUrl) : pdir;
    }
  }
  return { paths, baseDir };
}

/** Map an alias specifier to a filesystem path using tsconfig paths. */
function resolveAlias(spec, tsconfig) {
  for (const [key, targets] of Object.entries(tsconfig.paths)) {
    const target = Array.isArray(targets) ? targets[0] : targets;
    if (!target) continue;
    if (key.endsWith("/*")) {
      const prefix = key.slice(0, -1);
      if (spec.startsWith(prefix)) return { alias: key, path: resolve(tsconfig.baseDir, target.replace("*", spec.slice(prefix.length))) };
    } else if (spec === key) {
      return { alias: key, path: resolve(tsconfig.baseDir, target) };
    }
  }
  return null;
}

function componentOf(file, pkgDir, depth) {
  const rel = relative(pkgDir, file).split(sep);
  const srcIdx = rel[0] === "src" ? 1 : 0;
  const segs = rel.slice(srcIdx);
  if (segs.length === 1) return srcIdx ? `src/${segs[0]}` : segs[0];
  const take = CONTAINER_DIRS.has(segs[0]) && segs.length > 2 ? Math.min(depth, segs.length - 1) : 1;
  return (srcIdx ? "src/" : "") + segs.slice(0, take).join("/");
}

function scanSources(pkg, packages) {
  const { dir } = pkg;
  const tsconfig = loadTsconfig(dir);
  const aliasKeys = Object.keys(tsconfig.paths).map((k) => k.replace(/\/\*$/, ""));
  const files = listSourceFiles(dir, SRC_EXT);
  const usage = new Map();          // external package -> Set(files)
  const edges = new Map();          // "from>to" component edge -> count
  const crossRelative = [];         // relative imports escaping the package
  const aliasLinks = new Map();     // alias key -> { target, count, files }

  const otherPkgFor = (abs) => packages.find((p) => p !== pkg && abs.startsWith(p.dir + sep));

  for (const file of files) {
    let text;
    try { if (statSync(file).size > 2 * MB) continue; text = stripComments(readFileSync(file, "utf8")); } catch { continue; }
    const fromComp = componentOf(file, dir, opts.depth);
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      let targetPath = null;
      if (spec.startsWith(".")) {
        targetPath = resolve(dirname(file), spec);
      } else {
        const aliased = aliasKeys.length ? resolveAlias(spec, tsconfig) : null;
        if (aliased) {
          targetPath = aliased.path;
          const entry = aliasLinks.get(aliased.alias) || { target: aliased.path, count: 0, files: new Set() };
          entry.count += 1; entry.files.add(relative(opts.root, file));
          aliasLinks.set(aliased.alias, entry);
        } else {
          const name = specifierToPackage(spec);
          if (name) {
            if (!usage.has(name)) usage.set(name, new Set());
            usage.get(name).add(relative(dir, file));
          }
          continue;
        }
      }
      if (!targetPath.startsWith(dir + sep)) {
        // A relative specifier whose target does not exist is almost always a string inside
        // generated code or a test fixture, not a real import — skip it.
        if (spec.startsWith(".") && !importTargetExists(targetPath)) continue;
        const other = otherPkgFor(targetPath);
        const relFile = relative(opts.root, file);
        if (!crossRelative.some((c) => c.file === relFile && c.specifier === spec)) {
          crossRelative.push({ file: relFile, specifier: spec, target: relative(opts.root, targetPath), targetPackage: other?.json.name || null, viaAlias: !spec.startsWith(".") });
        }
        continue;
      }
      const toComp = componentOf(targetPath, dir, opts.depth);
      if (toComp !== fromComp) {
        const k = `${fromComp}>${toComp}`;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
  }

  // Script and config references: bins invoked in package.json scripts, or the package
  // name quoted in a config file (vitest environment, postcss plugins, next.config ...).
  const scripts = Object.values(pkg.json.scripts || {}).join("\n");
  // Config files live outside src/ (vitest.config, postcss.config, next.config ...); stylesheets
  // anywhere count too, because `@import "tailwindcss"` is how CSS-first tools get loaded.
  const configFiles = listSourceFiles(dir, CONFIG_EXT).filter((f) => !/package(-lock)?\.json$|pnpm-lock|tsconfig.*\.json$/.test(f) && (!f.includes(`${sep}src${sep}`) || /\.s?css$/.test(f)));
  const configText = configFiles.map((f) => { try { return statSync(f).size < MB ? readFileSync(f, "utf8") : ""; } catch { return ""; } }).join("\n");

  return { files: files.length, usage, edges, crossRelative, aliasLinks, tsconfig, aliasKeys, scripts, configText };
}

// ---------------------------------------------------------------------------------------------
// 4. Assemble per-package data
// ---------------------------------------------------------------------------------------------

function analyzePackage(pkg, packages) {
  const { dir, json } = pkg;
  const name = json.name || relative(opts.root, dir) || basename(dir);
  const relDir = relative(opts.root, dir) || ".";
  log(`package ${name} (${relDir})`);
  const { manager, lockfile } = detectManager(dir);
  const nm = join(dir, "node_modules");
  const nmInstalled = existsSync(nm);
  const nmSize = nmInstalled ? dirSize(nm, false) : { bytes: 0, files: 0 };
  const src = scanSources(pkg, packages);

  const declared = [];
  const kinds = [["dependencies", "prod"], ["devDependencies", "dev"], ["peerDependencies", "peer"], ["optionalDependencies", "optional"]];
  for (const [field, type] of kinds) {
    for (const [depName, range] of Object.entries(json[field] || {})) declared.push({ name: depName, type, range });
  }

  // Resolve every declared dependency first, so the usage rules can look at each other's
  // peerDependencies (react-dom is "used" because next requires it as a peer).
  const resolved = new Map(declared.map((d) => { const real = nmInstalled ? resolveFrom(dir, d.name) : null; return [d.name, real ? installedInfo(real) : null]; }));
  const versionsSeen = new Map(); // name -> Map(version -> {bytes, via:Set, viaProd})
  const deps = declared.map((d) => {
    const info = resolved.get(d.name);
    const real = info?.real || null;
    let transitiveBytes = 0, transitiveCount = 0, nativeInClosure = false;
    if (info && d.type !== "peer") {
      const closure = closureOf(real);
      for (const [, c] of closure) {
        transitiveBytes += c.ownBytes;
        if (c.native) nativeInClosure = true;
        if (!versionsSeen.has(c.name)) versionsSeen.set(c.name, new Map());
        const vmap = versionsSeen.get(c.name);
        if (!vmap.has(c.version)) vmap.set(c.version, { bytes: c.ownBytes, via: new Set(), viaProd: false });
        vmap.get(c.version).via.add(d.name);
        if (d.type === "prod") vmap.get(c.version).viaProd = true;
      }
      transitiveCount = closure.size - 1;
    }
    const importFiles = src.usage.get(d.name);
    const peerOf = declared.filter((x) => x.name !== d.name && resolved.get(x.name)?.peers.includes(d.name)).map((x) => x.name);
    const bins = info?.bin || [];
    const usedByScript = bins.some((b) => new RegExp(`(^|[\\s"'&|;(])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$|"|')`, "m").test(src.scripts));
    const usedByConfig = new RegExp(`['"\`]${d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/[^'"\`]*)?['"\`]`).test(src.configText);
    const isTypes = d.name.startsWith("@types/");
    const typesTarget = isTypes ? d.name.slice(7).replace("__", "/") : null;
    const typesUseful = isTypes && (typesTarget === "node" || declared.some((x) => x.name === typesTarget || x.name === `@${typesTarget}`));
    const usedBy = [];
    if (importFiles?.size) usedBy.push("imports");
    if (usedByScript) usedBy.push("scripts");
    if (usedByConfig) usedBy.push("config");
    if (typesUseful) usedBy.push("types-for-declared-dep");
    if (peerOf.length) usedBy.push(`peer-of:${peerOf.slice(0, 3).join(",")}`);
    const category = categorize(d.name);
    const protocol = /^(workspace|file|link):/.exec(d.range)?.[1] || null;
    return {
      name: d.name,
      type: d.type,
      category,
      declared: d.range,
      protocol,
      installed: info?.version || null,
      license: info?.license || null,
      ownMb: info ? toMb(info.ownBytes) : null,
      transitiveMb: info ? toMb(transitiveBytes) : null,
      transitiveCount,
      native: Boolean(info?.native || nativeInClosure),
      usedBy,
      importedFrom: importFiles ? [...importFiles].slice(0, 5) : [],
      importCount: importFiles?.size || 0,
      installedPath: real ? relative(opts.root, real) : null,
    };
  });

  const duplicates = [...versionsSeen.entries()]
    .filter(([, vmap]) => vmap.size > 1)
    .map(([depName, vmap]) => ({
      name: depName,
      versions: [...vmap.entries()].map(([v, x]) => ({ version: v, mb: toMb(x.bytes), via: [...x.via].slice(0, 6) })),
      viaProd: [...vmap.values()].filter((x) => x.viaProd).length > 1,
      wastedMb: toMb([...vmap.values()].map((x) => x.bytes).sort((a, b) => b - a).slice(1).reduce((a, b) => a + b, 0)),
      level: (() => { const vs = [...vmap.keys()]; return vs.some((v) => diffLevel(v, vs[0]) === "major") ? "major" : "minor/patch"; })(),
    }))
    .sort((a, b) => b.wastedMb - a.wastedMb);

  const declaredNames = new Set(declared.map((d) => d.name));
  const phantom = [...src.usage.entries()]
    .filter(([n]) => !declaredNames.has(n) && !src.aliasKeys.some((k) => n === k || n.startsWith(k + "/")))
    .map(([n, files]) => ({ name: n, resolves: nmInstalled ? Boolean(resolveFrom(dir, n)) : null, files: [...files].slice(0, 5), count: files.size }));

  const aliasLinks = [...src.aliasLinks.entries()].map(([alias, e]) => {
    const inside = e.target.startsWith(dir + sep);
    const other = packages.find((p) => p !== pkg && e.target.startsWith(p.dir + sep));
    const vendored = inside && /[\\/]vendor[\\/]/.test(e.target);
    return { alias, target: relative(opts.root, e.target), kind: other ? "cross-package-alias" : vendored ? "vendored-copy" : "internal-alias", targetPackage: other?.json.name || null, count: e.count, files: [...e.files].slice(0, 5) };
  });

  const components = (() => {
    const nodes = new Map();
    for (const [k, count] of src.edges) {
      const [from, to] = k.split(">");
      nodes.set(from, (nodes.get(from) || 0) + count);
      nodes.set(to, (nodes.get(to) || 0) + count);
    }
    const kept = new Set([...nodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([n]) => n));
    return {
      nodes: [...kept],
      edges: [...src.edges.entries()].filter(([k]) => k.split(">").every((n) => kept.has(n))).map(([k, count]) => { const [from, to] = k.split(">"); return { from, to, count }; }).sort((a, b) => b.count - a.count),
      truncated: nodes.size - kept.size,
    };
  })();

  return {
    name, dir: relDir, manager, lockfile,
    nodeModulesInstalled: nmInstalled,
    nodeModulesMb: toMb(nmSize.bytes), nodeModulesFiles: nmSize.files,
    sourceFiles: src.files,
    counts: { prod: declared.filter((d) => d.type === "prod").length, dev: declared.filter((d) => d.type === "dev").length, peer: declared.filter((d) => d.type === "peer").length, optional: declared.filter((d) => d.type === "optional").length },
    deps, duplicates, phantom, aliasLinks, crossRelative: src.crossRelative, components,
    tsconfigPaths: Object.keys(src.tsconfig.paths),
  };
}

// ---------------------------------------------------------------------------------------------
// 5. Cross-package analysis
// ---------------------------------------------------------------------------------------------

function hashDir(dir) {
  const h = createHash("sha1");
  const files = listSourceFiles(dir, new Set([...SRC_EXT, ".json", ".md"])).sort();
  for (const f of files) { h.update(relative(dir, f)); try { h.update(readFileSync(f)); } catch { /* skip */ } }
  return { hash: h.digest("hex").slice(0, 12), files: files.length };
}

function crossPackage(results, rawPackages) {
  const byDep = new Map();
  for (const p of results) for (const d of p.deps) {
    if (d.protocol) continue;
    if (!byDep.has(d.name)) byDep.set(d.name, []);
    byDep.get(d.name).push({ package: p.name, type: d.type, declared: d.declared, installed: d.installed, category: d.category });
  }
  const shared = [...byDep.entries()].filter(([, v]) => v.length > 1).map(([name, owners]) => {
    const installed = [...new Set(owners.map((o) => o.installed).filter(Boolean))];
    const ranges = [...new Set(owners.map((o) => o.declared))];
    let drift = "none";
    for (const a of installed) for (const b of installed) { const l = diffLevel(a, b); if (l === "major") drift = "major"; else if (l === "minor" && drift !== "major") drift = "minor"; else if (l === "patch" && drift === "none") drift = "patch"; }
    return { name, category: owners[0].category, owners, installed, ranges, drift, rangeDrift: ranges.length > 1 };
  }).sort((a, b) => ["major", "minor", "patch", "none"].indexOf(a.drift) - ["major", "minor", "patch", "none"].indexOf(b.drift));

  // Vendored copies: same alias name pointing at a vendor/ folder in more than one package.
  const vendored = new Map();
  for (const p of results) for (const l of p.aliasLinks) if (l.kind === "vendored-copy") {
    const key = l.alias.replace(/\/\*$/, "");
    if (!vendored.has(key)) vendored.set(key, []);
    const targetDir = (() => { const t = resolve(opts.root, l.target); try { return statSync(t).isDirectory() ? t : dirname(t); } catch { return dirname(t); } })();
    vendored.get(key).push({ package: p.name, target: relative(opts.root, targetDir), imports: l.count, ...hashDir(targetDir) });
  }
  const vendoredCopies = [...vendored.entries()].map(([alias, copies]) => {
    const merged = new Map();
    for (const c of copies) { const k = `${c.package}|${c.target}`; if (!merged.has(k)) merged.set(k, c); else merged.get(k).imports += c.imports; }
    const list = [...merged.values()];
    return { alias, copies: list, identical: new Set(list.map((c) => c.hash)).size === 1 };
  }).filter((v) => v.copies.length > 1);

  const links = [];
  for (const p of results) {
    for (const l of p.aliasLinks) if (l.kind === "cross-package-alias") links.push({ from: p.name, to: l.targetPackage, kind: "tsconfig-alias", via: l.alias, count: l.count, target: l.target });
    for (const d of p.deps) if (d.protocol) links.push({ from: p.name, to: d.name, kind: `${d.protocol}:`, via: d.declared, count: d.importCount });
    const grouped = new Map();
    for (const c of p.crossRelative) if (!c.viaAlias) { const k = c.targetPackage || c.target; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(c); }
    for (const [to, items] of grouped) links.push({ from: p.name, to, kind: "relative-import", via: items[0].specifier, count: items.length, target: items[0].target, files: items.map((i) => i.file).slice(0, 5) });
  }
  for (const v of vendoredCopies) for (const c of v.copies) links.push({ from: c.package, to: `vendored ${v.alias}`, kind: "vendored-copy", via: v.alias, count: c.imports, target: c.target });

  const managers = [...new Set(results.map((p) => p.manager || "none"))];
  return { shared, vendoredCopies, links, managers, workspace: detectWorkspace(opts.root, rawPackages.find((p) => p.dir === opts.root)?.json) };
}

// ---------------------------------------------------------------------------------------------
// 6. Optional: latest versions from the registry
// ---------------------------------------------------------------------------------------------

async function fetchLatest(names) {
  const latest = new Map();
  const queue = [...names];
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      await new Promise((done) => {
        execFile("npm", ["view", n, "version", "--json"], { encoding: "utf8", timeout: 20000 }, (err, stdout) => {
          if (!err) { try { const v = JSON.parse(stdout); latest.set(n, Array.isArray(v) ? v.at(-1) : v); } catch { /* ignore */ } }
          done();
        });
      });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return latest;
}

// ---------------------------------------------------------------------------------------------
// 7. Findings
// ---------------------------------------------------------------------------------------------

function buildFindings(results, cross) {
  const F = [];
  const add = (tier, code, pkg, subject, evidence, suggestion, impactMb = 0, confidence = "high") =>
    F.push({ tier, code, package: pkg, subject, evidence, suggestion, impactMb, confidence });

  for (const p of results) {
    const hasDeps = p.counts.prod + p.counts.dev > 0;
    if (hasDeps && !p.lockfile) add("P0", "MISSING_LOCKFILE", p.name, p.dir, "declares dependencies but has no lockfile", `commit a lockfile (run the package manager's install in ${p.dir})`);
    if (hasDeps && !p.nodeModulesInstalled) add("Info", "NOT_INSTALLED", p.name, p.dir, "node_modules is absent, so sizes and usage are unmeasured here", "install, then re-run the scan for size data");

    for (const ph of p.phantom) {
      // Only seen in test files? Often a fixture string rather than a real import — say so.
      const testsOnly = ph.files.every((f) => /(^|\/)(test|tests|__tests__|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
      const conf = testsOnly ? "low" : ph.resolves === null ? "medium" : "high";
      if (ph.resolves === false) add(testsOnly ? "Info" : "P0", "UNRESOLVABLE_IMPORT", p.name, ph.name, `imported in ${ph.count} file(s) (e.g. ${ph.files[0]}) but neither declared nor installed${testsOnly ? " — only in test files, possibly fixture text" : ""}`, `add ${ph.name} to ${p.dir}/package.json or remove the import`, 0, conf);
      else add(testsOnly ? "P2" : "P1", "PHANTOM_DEPENDENCY", p.name, ph.name, `imported in ${ph.count} file(s) (e.g. ${ph.files[0]}) without being declared; it only resolves through another package's dependency tree`, `declare ${ph.name} explicitly in ${p.dir}/package.json so an upstream change cannot break the build`, 0, conf);
    }

    for (const c of p.crossRelative.filter((x) => !x.viaAlias)) {
      add("P0", "CROSS_PACKAGE_RELATIVE_IMPORT", p.name, c.target, `${c.file} imports ${c.specifier}, reaching into ${c.targetPackage || "another folder"} by relative path instead of its public entry point`, `import through the package's declared entry (alias or package name) so ${c.targetPackage || "the target"} can refactor internals safely`);
    }

    for (const d of p.deps) {
      if (d.protocol) continue;
      const unused = d.usedBy.length === 0 && d.installed;
      if (unused && d.type === "prod") add("P1", "UNUSED_DEPENDENCY", p.name, d.name, `declared in dependencies, installed at ${d.installed}, but no import, script or config references it (${d.transitiveMb ?? "?"} MB with ${d.transitiveCount} transitive packages)`, `confirm with a grep, then remove it from ${p.dir}/package.json`, d.transitiveMb || 0, "medium");
      else if (unused && d.type === "dev") add("Info", "UNREFERENCED_DEV_DEPENDENCY", p.name, d.name, `devDependency with no import, script or config reference found (${d.transitiveMb ?? "?"} MB)`, `check whether a tool loads it implicitly; if not, remove it`, d.transitiveMb || 0, "low");
      if (d.type === "prod" && TOOLING_CATEGORIES.has(d.category)) add("P2", "TOOLING_IN_PROD", p.name, d.name, `${d.category} package listed under dependencies instead of devDependencies`, `move ${d.name} to devDependencies in ${p.dir}/package.json`, d.transitiveMb || 0);
      if (d.type === "prod" && d.transitiveMb >= opts.heavyMb && d.category !== "framework") add("P2", "HEAVY_DEPENDENCY", p.name, d.name, `${d.transitiveMb} MB across ${d.transitiveCount} transitive packages (own ${d.ownMb} MB); ${d.importCount} importing file(s)`, `check whether a lighter alternative or a narrower import covers the ${d.importCount} use(s)`, d.transitiveMb);
      if (d.type === "prod" && d.license && COPYLEFT.test(d.license)) add("P1", "COPYLEFT_LICENSE", p.name, d.name, `license ${d.license} in a runtime dependency`, `confirm the license is acceptable for how this code ships`);
      if (d.latest && d.installed) {
        const lvl = diffLevel(d.installed, d.latest);
        if (lvl === "major") add("P2", "OUTDATED_MAJOR", p.name, d.name, `installed ${d.installed}, latest ${d.latest}`, `plan a major upgrade; read the changelog for breaking changes`);
        else if (lvl === "minor") add("Info", "OUTDATED_MINOR", p.name, d.name, `installed ${d.installed}, latest ${d.latest}`, `bump within the declared range`);
      }
    }

    const natives = p.deps.filter((d) => d.native).map((d) => d.name);
    if (natives.length) add("Info", "NATIVE_MODULES", p.name, natives.join(", "), `${natives.length} dependenc${natives.length === 1 ? "y ships" : "ies ship"} or pull in native binaries, so installs are platform-specific`, `make sure CI and Docker images build on the same platform set, and keep the lockfile's optional platform packages`);

    // Duplicate versions: a singleton library (react, zod ...) loaded twice at runtime is a
    // correctness bug; everything else is weighed by the megabytes it wastes. Tiny duplicates
    // among dev tooling are normal in any lockfile, so only the ten largest reach the findings
    // list — the full table still shows all of them.
    let infoDups = 0;
    for (const dup of p.duplicates) {
      const singleton = SINGLETON_LIBS.has(dup.name) && dup.viaProd;
      const tier = singleton ? "P0" : dup.viaProd && dup.wastedMb >= 5 ? "P1" : dup.wastedMb >= 1 || (dup.level === "major" && dup.viaProd && dup.wastedMb >= 0.3) ? "P2" : "Info";
      if (tier === "Info" && ++infoDups > 10) continue;
      add(tier, "DUPLICATE_VERSIONS", p.name, dup.name, `${dup.versions.length} versions installed (${dup.versions.map((v) => `${v.version} via ${v.via.slice(0, 2).join(", ")}`).join("; ")}), ${dup.wastedMb} MB duplicated${dup.viaProd ? ", reachable from runtime deps" : ", dev tooling only"}`, singleton ? `two copies of ${dup.name} at runtime can break instanceof/context; align the ranges that pull them in` : `${dup.viaProd ? "" : "dev-only, so disk and install time rather than runtime risk: "}align ranges or add a package-manager override so one version is installed`, dup.wastedMb, dup.viaProd ? "high" : "low");
    }
  }

  for (const s of cross.shared) {
    if (s.drift === "none" && !s.rangeDrift) continue;
    const singleton = SINGLETON_LIBS.has(s.name);
    const devOnly = s.owners.every((o) => o.type !== "prod");
    const tier = devOnly ? (s.drift === "major" ? "P2" : "Info") : s.drift === "major" ? "P1" : s.drift === "minor" ? (singleton ? "P1" : "P2") : "Info";
    add(tier, "VERSION_DRIFT", "(cross-package)", s.name, `${s.owners.map((o) => `${o.package}: ${o.declared}${o.installed ? ` (installed ${o.installed})` : ""}`).join("; ")}${devOnly ? " — dev tooling only" : ""}`, `pin one range for ${s.name} in every package.json${singleton ? " (types and runtime behaviour of this library flow across package boundaries)" : ""}`);
  }
  for (const v of cross.vendoredCopies) {
    add(v.identical ? "P2" : "P1", v.identical ? "VENDORED_COPY_DUPLICATED" : "VENDORED_COPY_DIVERGED", "(cross-package)", v.alias, `${v.copies.map((c) => `${c.package} -> ${c.target} (${c.files} files, hash ${c.hash})`).join("; ")} — copies are ${v.identical ? "identical" : "DIFFERENT"}`, v.identical ? `pick one source of truth and make the other packages consume it (path alias or a tiny shared package)` : `diff the copies, reconcile, then stop maintaining two versions`);
  }
  if (cross.managers.length > 1) add("Info", "MIXED_PACKAGE_MANAGERS", "(cross-package)", cross.managers.join(" + "), `packages use different package managers: ${results.map((p) => `${p.name}=${p.manager || "none"}`).join(", ")}`, `standardise on one manager so install, CI and caching behave the same everywhere`);

  const order = { P0: 0, P1: 1, P2: 2, Info: 3 };
  return F.sort((a, b) => order[a.tier] - order[b.tier] || b.impactMb - a.impactMb);
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  log(`root ${opts.root}`);
  const raw = discoverPackages(opts.root);
  if (!raw.length) { console.error("No package.json found under", opts.root); process.exit(2); }
  const results = raw.map((p) => analyzePackage(p, raw));

  if (opts.outdated) {
    const names = new Set(results.flatMap((p) => p.deps.filter((d) => !d.protocol).map((d) => d.name)));
    log(`checking latest versions for ${names.size} packages (npm view)...`);
    const latest = await fetchLatest(names);
    for (const p of results) for (const d of p.deps) if (latest.has(d.name)) d.latest = latest.get(d.name);
  }

  const cross = crossPackage(results, raw);
  const findings = buildFindings(results, cross);
  const totals = {
    packages: results.length,
    nodeModulesMb: toMb(results.reduce((a, p) => a + p.nodeModulesMb * MB, 0)),
    declared: results.reduce((a, p) => a + p.deps.length, 0),
    findings: Object.fromEntries(["P0", "P1", "P2", "Info"].map((t) => [t, findings.filter((f) => f.tier === t).length])),
  };
  const out = {
    tool: "dependency-checker/scan.mjs",
    generatedAt: new Date().toISOString(),
    root: opts.root,
    options: { ignores: [...opts.ignores], heavyMb: opts.heavyMb, depth: opts.depth, outdated: opts.outdated },
    durationMs: Date.now() - t0,
    totals,
    packages: results,
    cross,
    findings,
  };
  const text = JSON.stringify(out, null, 2);
  if (opts.out) { const { writeFileSync, mkdirSync } = await import("node:fs"); mkdirSync(dirname(resolve(opts.out)), { recursive: true }); writeFileSync(opts.out, text); log(`wrote ${opts.out} in ${out.durationMs} ms`); }
  else process.stdout.write(text + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
