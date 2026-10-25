# Dependency types

Three axes describe every dependency in the report: **where it comes from** (external npm
package or internal link), **what it is for** (category), and **how it is declared** (prod,
dev, peer, optional). Size bands sit on top.

## External vs internal

| | External | Internal |
| --- | --- | --- |
| Source | npm registry, resolved through `node_modules` | this repository's own folders |
| Versioned by | semver range in `package.json`, pinned by the lockfile | git only — no range, no lockfile |
| Examples | `fastify@^5.2.0`, `react@^19` | tsconfig alias `@devdigest/shared` → `../server/src/vendor/shared`; `import '../../server/src/x'`; `workspace:*` |
| What goes wrong | drift, duplicates, unused, outdated, licenses, size | hidden coupling, two sources of truth, builds that only work in one checkout layout |
| Reported in | section 3 tables, section 4 codes `UNUSED_*`, `DUPLICATE_*`, `VERSION_DRIFT`, `HEAVY_*` | section 2 graph and link table, codes `CROSS_PACKAGE_RELATIVE_IMPORT`, `VENDORED_COPY_*`, `PHANTOM_*` for aliases that do not resolve |

### Kinds of internal link

| Kind | How it looks | Health |
| --- | --- | --- |
| `tsconfig-alias` | `paths: { "@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"] }` | fine when it targets the other package's public entry (`index.ts`); each alias should have one owner |
| `workspace:` / `file:` / `link:` | `"@acme/shared": "workspace:*"` | the managed way; implies a workspace root and one lockfile |
| `relative-import` | `import x from '../../other/src/internal.js'` | **always a finding** — bypasses the entry point and ties both packages to a directory layout |
| `vendored-copy` | the same folder copied under `src/vendor/` in two packages, each aliased to its own copy | fine as a one-off snapshot; a finding once two copies exist (identical = P2, diverged = P1) |

A repository where each package has its own lockfile and links to siblings through tsconfig
aliases is **a set of independent packages, not a monorepo workspace**. Say so in Scope and
never describe the links as `workspace:*`.

## Categories

The scanner assigns one category per dependency from its name; override it in the narrative
when you know better.

| Category | What belongs | Examples |
| --- | --- | --- |
| `framework` | the runtime the package is built on and its first-party plugins | next, react, react-dom, fastify, @fastify/*, express |
| `ui` | rendering, styling, icons, charts, markdown | lucide-react, recharts, mermaid, react-markdown, tailwindcss, postcss, next-intl |
| `data` | databases, ORMs, drivers | drizzle-orm, postgres, pg, prisma, redis |
| `ai-llm` | model SDKs and tokenisers | openai, @anthropic-ai/sdk, js-tiktoken |
| `agent-sdk` | agent runtimes and MCP | @anthropic-ai/claude-agent-sdk, @modelcontextprotocol/* |
| `validation` | schema and input validation | zod, ajv, fastify-type-provider-zod |
| `git-vcs` | git and GitHub clients, code search | octokit, simple-git, @vscode/ripgrep |
| `code-analysis` | parsers, graph libraries, dependency tooling | dependency-cruiser, @ast-grep/napi, graphology |
| `testing` | test runners, DOM/test environments, containers | vitest, jsdom, @testing-library/*, testcontainers |
| `build-tooling` | compilers, bundlers, runners, generators, formatters | typescript, tsx, esbuild, drizzle-kit, pino-pretty |
| `types` | `@types/*` | @types/node, @types/react |
| `utility` | small general-purpose helpers | dotenv, p-queue, gray-matter, date-fns |
| `other` | anything the rules do not recognise | — |

`testing`, `build-tooling` and `types` are **tooling**: listed under `dependencies` they raise
`TOOLING_IN_PROD`. A `framework` dependency is never flagged heavy — a 130 MB `next` is the
price of using Next.

## Declaration types

| Type | Field | Installed where | In the report |
| --- | --- | --- | --- |
| `prod` | `dependencies` | everywhere, including production images | size, usage, license, drift all weigh fully |
| `dev` | `devDependencies` | development and CI only | usage findings are Info; duplicates and drift count as dev-only |
| `peer` | `peerDependencies` | expected to be provided by the consumer | not sized; a declared dep that is a peer of another declared dep counts as used (`peer-of:x`) |
| `optional` | `optionalDependencies` | installed when the platform matches | sized when present; typical for native binaries |

## Size bands

Sizes are **installed bytes on disk**, from walking `node_modules`, not bundle output.

| Band | Transitive size | Reading |
| --- | --- | --- |
| tiny | < 1 MB | ignore in prioritisation |
| small | 1–5 MB | normal library |
| medium | 5–15 MB | mention if unused or duplicated |
| heavy | ≥ 15 MB (the `--heavy-mb` default) | `HEAVY_DEPENDENCY` for runtime, non-framework packages |
| very heavy | ≥ 100 MB | usually a framework, a bundled binary (agent SDKs, browsers) or a diagram/chart suite; name it in the opening paragraph |

Two caveats to repeat whenever numbers are compared:

- **Transitive sizes overlap.** `recharts` and `mermaid` both pull in `d3-*`; adding their
  transitive totals double-counts it. The per-package `node_modules` figure is the truth.
- **Front-end install size ≠ shipped size.** A 27 MB icon set tree-shakes to a few kilobytes
  when three icons are imported. Use the import count in the table before calling it heavy.

## Usage evidence

`Used by` in the dependency table means one of:

| Value | Evidence |
| --- | --- |
| `imports` | an `import`/`require` of the package or a sub-path in a source file (comments stripped) |
| `scripts` | one of its bins (`tsc`, `vitest`, `drizzle-kit` …) appears in `package.json` scripts |
| `config` | the package name is quoted in a config file outside `src/` or in a stylesheet (`@import "tailwindcss"`) |
| `peer-of:x` | a declared dependency `x` lists it in `peerDependencies` (react-dom for next) |
| `types-for-declared-dep` | an `@types/*` package whose target is declared, or `@types/node` |

Nothing found means *nothing found statically*. Dynamic loads by string (logger transports,
plugin registries, CLI `--require`) are invisible; check before recommending removal.
