import { sql, desc } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import type { EvalCaseMeta, EvalCaseOutcome, EvalExpectation } from '@devdigest/shared';

// ============================================================ Eval / Conformance / Compose
//
// Eval Pipeline (L06). `eval_cases` / `eval_runs` were reserved-but-unwired
// (zero rows) until this lesson, so they are reshaped in place:
//  - a CASE freezes one file's diff fragment + one expectation
//    (`expected_output` keeps its reserved column name; the DTO calls it
//    `expectation`);
//  - a RUN is one agent version replayed over a FIXED case set (`case_ids`)
//    with the per-case outcomes and the set-level metrics stored on the row.

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    /** Self-contained unified diff (one file's hunks) — never a live pointer. */
    inputDiff: text('input_diff').notNull(),
    inputFiles: jsonb('input_files').$type<string[]>().notNull(),
    /** Trimmed PR metadata: { pr_number, title, body }. */
    inputMeta: jsonb('input_meta').$type<EvalCaseMeta>().notNull(),
    expectedOutput: jsonb('expected_output').$type<EvalExpectation>().notNull(),
    notes: text('notes'),
    /** The finding this case came from — no FK: a case outlives its finding. */
    sourceFindingId: uuid('source_finding_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // "Turn into eval case" is idempotent per (finding, owner). Postgres lets
    // many NULLs through, so hand-authored cases are unaffected.
    sourceFindingUq: uniqueIndex('eval_cases_source_finding_uq').on(
      t.sourceFindingId,
      t.ownerKind,
      t.ownerId,
    ),
    ownerIdx: index('eval_cases_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    /** suite = whole case set (dashboard/trend/compare); case = ad-hoc single case. */
    scope: text('scope', { enum: ['suite', 'case'] }).notNull().default('suite'),
    status: text('status', { enum: ['running', 'completed', 'errored'] })
      .notNull()
      .default('running'),
    /** `agents.version` at run time → `agent_versions` snapshot for the prompt diff. */
    agentVersion: integer('agent_version'),
    caseIds: jsonb('case_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    perCase: jsonb('per_case').$type<EvalCaseOutcome[]>().notNull().default(sql`'[]'::jsonb`),
    casesErrored: integer('cases_errored').notNull().default(0),
    tracesPassed: integer('traces_passed'),
    tracesTotal: integer('traces_total'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    errorReason: text('error_reason'),
  },
  (t) => ({
    ownerIdx: index('eval_runs_owner_idx').on(
      t.workspaceId,
      t.ownerKind,
      t.ownerId,
      desc(t.ranAt),
    ),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
