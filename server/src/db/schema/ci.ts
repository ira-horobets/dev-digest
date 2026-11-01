import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status').notNull().default('active'),
    branch: text('branch').notNull().default('devdigest/ci'),
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    prState: text('pr_state', { enum: ['open', 'merged', 'closed'] }),
    prStateCheckedAt: timestamp('pr_state_checked_at', { withTimezone: true }),
    workflowVersion: text('workflow_version'),
    /** sha256 of the non-editable generated files + template version (out-of-date check). */
    configHash: text('config_hash'),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    triggers: jsonb('triggers').$type<string[]>().notNull().default(['opened', 'synchronize']),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    agentRepoTargetUidx: uniqueIndex('ci_installations_agent_repo_target_uidx').on(
      t.agentId,
      t.repo,
      t.targetType,
    ),
  }),
);

/** One entry per install or update attempt of an installation. */
export const ciInstallationEvents = pgTable(
  'ci_installation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => ciInstallations.id, { onDelete: 'cascade' }),
    action: text('action', { enum: ['install', 'update'] }).notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
    templateVersion: text('template_version'),
    configHash: text('config_hash'),
    outcome: text('outcome', { enum: ['succeeded', 'failed'] }).notNull(),
    prUrl: text('pr_url'),
    error: text('error'),
  },
  (t) => ({
    installationAtIdx: index('ci_installation_events_installation_at_idx').on(t.installationId, t.at),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    githubRunId: bigint('github_run_id', { mode: 'number' }),
    runAttempt: integer('run_attempt'),
    verdict: text('verdict'),
    durationMs: integer('duration_ms'),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    error: text('error'),
    blockers: integer('blockers'),
  },
  (t) => ({
    instRunAttemptUidx: uniqueIndex('ci_runs_inst_run_attempt_uidx').on(
      t.ciInstallationId,
      t.githubRunId,
      t.runAttempt,
    ),
    instRanAtIdx: index('ci_runs_inst_ran_at_idx').on(t.ciInstallationId, t.ranAt),
  }),
);
