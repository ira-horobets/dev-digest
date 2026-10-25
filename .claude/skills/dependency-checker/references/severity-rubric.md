# Severity rubric

Four tiers. The question behind each one is *what happens if nobody acts*:

| Tier | If nobody acts… | Expected response |
| --- | --- | --- |
| **P0** | a build, install or runtime behaviour breaks now or on the next clean install | fix before the next merge |
| **P1** | the team pays today: wasted megabytes on every install, drift that will bite on the next upgrade, imports that only work by accident | schedule this sprint |
| **P2** | nothing breaks, but the estate is heavier, slower or messier than it needs to be | ticket it, batch with related work |
| **Info** | nothing to do; the maintainer should simply know | leave in the report |

Within a tier, order by the megabytes involved (largest first); ties by how many files are
affected. Every finding carries a **confidence**: `high` (the scanner saw it directly),
`medium` (static evidence, a dynamic load could contradict it), `low` (likely noise, listed
for completeness). Verify `medium` findings before presenting them as fact; never put a
`low` finding in the Summary.

## Finding codes

### P0

| Code | Trigger | Why it is P0 | Suggested action |
| --- | --- | --- | --- |
| `MISSING_LOCKFILE` | a package declares dependencies but has no lockfile | every install resolves ranges anew; CI and laptops drift apart silently | run the package manager's install and commit the lockfile |
| `UNRESOLVABLE_IMPORT` | source imports a package that is neither declared nor installed | the build fails on a clean checkout (if it passes locally, something stale is on disk) | declare it, or remove the import; Info if it only appears in test fixture text |
| `CROSS_PACKAGE_RELATIVE_IMPORT` | `../../other-package/src/...` from inside one package | couples two packages to each other's file layout; the target cannot move a file without breaking a neighbour it does not know about | import through the alias or package entry point the target exposes |
| `DUPLICATE_VERSIONS` (singleton) | a singleton library (react, react-dom, next, fastify, drizzle-orm, zod, graphology) installed at two versions, both reachable from runtime deps | two copies at runtime break `instanceof`, React context, Zod schema identity, Fastify plugin registration | align the ranges that pull in each copy, or add an override |

### P1

| Code | Trigger | Why it is P1 | Suggested action |
| --- | --- | --- | --- |
| `UNUSED_DEPENDENCY` | a runtime dependency with no import, script, config, stylesheet or peer reference | installed, audited and shipped for nothing; a security advisory on it still costs a response | confirm with a grep that includes strings and configs, then remove it (`pnpm remove x`) |
| `PHANTOM_DEPENDENCY` | an import that resolves only because another dependency happens to pull the package in | works until the upstream package drops or bumps it; hoisting differences between pnpm and npm expose it first | declare it explicitly with a range |
| `VERSION_DRIFT` (major, runtime) | the same runtime library at different majors across packages | shared types and shared wire formats diverge; upgrading one package forces the others | pin one range in every `package.json`, upgrade together |
| `VERSION_DRIFT` (minor, singleton) | zod / react style library at different minors across packages that exchange its values or types | type errors and subtle behaviour differences across the boundary | align the ranges |
| `VENDORED_COPY_DIVERGED` | the same shared folder vendored into two packages with different content | two sources of truth; the next change lands in one of them | diff, reconcile, then make one package the owner and alias the other to it |
| `DUPLICATE_VERSIONS` (≥ 5 MB, runtime) | large duplicate reachable from runtime dependencies | disk, install time, and two code paths to patch on an advisory | `pnpm dedupe` / `npm dedupe`, or an override |
| `COPYLEFT_LICENSE` | GPL/AGPL/LGPL/SSPL in a runtime dependency | may obligate source disclosure depending on how the product ships | legal/lead confirms, or replace |

### P2

| Code | Trigger | Why it is P2 | Suggested action |
| --- | --- | --- | --- |
| `HEAVY_DEPENDENCY` | runtime dependency over the heavy threshold (default 15 MB transitive), not a framework | install time, image size, attack surface; often one function is used | check the import count; look for a narrower import or a lighter library |
| `TOOLING_IN_PROD` | types, test or build tooling listed under `dependencies` | ships to production images and audits for nothing | move to `devDependencies` |
| `VERSION_DRIFT` (minor, non-singleton runtime) | same runtime library at different minors | upgrade friction, inconsistent behaviour | align when next touching either package |
| `DUPLICATE_VERSIONS` (1–5 MB, or major-level runtime ≥ 0.3 MB) | moderate duplicate | wasted megabytes; two patch targets | dedupe with the next lockfile refresh |
| `OUTDATED_MAJOR` (needs `--outdated`) | installed major behind the registry | security fixes and features stop arriving; the jump grows | plan the upgrade, read the changelog |
| `VENDORED_COPY_DUPLICATED` | identical vendored copies in two packages | works today, diverges tomorrow | one owner, alias the rest |
| `PHANTOM_DEPENDENCY` (tests only) | undeclared import seen only in test files | tests depend on hoisting luck | declare as a devDependency |

### Info

| Code | Trigger | Why it is only Info |
| --- | --- | --- |
| `UNREFERENCED_DEV_DEPENDENCY` | devDependency with no reference found | tooling is often loaded implicitly (a transport, a plugin, a preset); flag it, let the owner decide |
| `VERSION_DRIFT` (dev-only) | typescript / vitest / tsx at different ranges | harmless at runtime; aligning is housekeeping |
| `DUPLICATE_VERSIONS` (small or dev-only) | sub-megabyte duplicates, or duplicates only reachable from dev tooling | every lockfile has them; listed in the table, top ten in findings |
| `NATIVE_MODULES` | dependencies shipping native binaries | installs are platform-specific: CI, Docker and laptops must agree |
| `MIXED_PACKAGE_MANAGERS` | pnpm here, npm there | install and cache behaviour differ per folder; worth standardising, not urgent |
| `OUTDATED_MINOR` | behind by a minor | bump within range when convenient |
| `NOT_INSTALLED` | no `node_modules` for a package | sizes and usage could not be measured; install and re-scan |

## Promotion and demotion rules

- **Promote** a finding one tier when it sits on a package boundary that exchanges values
  (shared Zod schemas, React components, Fastify plugins) — that is why `zod` drift across
  server, client and a shared core is P1 even at minor level.
- **Promote** `UNUSED_DEPENDENCY` to the top of P1 when the package has a native build step
  or a large transitive tree: the removal saves the most.
- **Demote** `HEAVY_DEPENDENCY` to Info for a front-end library that is tree-shaken at
  build time (icon sets, chart libraries) when the import count shows narrow use — and say
  so.
- **Demote** anything that only appears in test fixtures, generated code or documentation
  strings to Info with the reason stated.
- Never promote on size alone past P1; a big package that is used is a trade-off, not a bug.

## Writing a finding

```
- **CODE** · `package` › `dependency or file` — evidence with the numbers.
  → the action, with the exact file or command. _(MB)_ _confidence: high|medium|low_
```

Evidence states what was observed (`declared in server/package.json, 4.2 MB, zero imports
under server/src`). The arrow line states what to do, as a recommendation the reader
confirms — never as something already done.
