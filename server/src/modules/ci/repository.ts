/**
 * ci — Drizzle repository (ring 3a). `ci_installations` / `ci_runs` carry no
 * `workspace_id`, so every query is scoped through `agents.workspace_id`.
 * Also reads agents, skills, memory, repos and PRs (never through another module).
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { NotFoundError } from '../../platform/errors.js';
import * as t from '../../db/schema.js';
import { CI_RUNS_LIMIT } from './constants.js';
import type {
  CiRepositoryPort,
  CiRunInsert,
  AgentRunInsert,
  CiRunRecord,
  CiRunsFilter,
  EventInsert,
  ExportAgent,
  ImportedRepo,
  InstallationRecord,
  InstallationUpsert,
  MemoryRow,
  StoredRunKey,
} from './ports.js';

class DuplicateRun extends Error {}

type InstallationRow = typeof t.ciInstallations.$inferSelect;
type EventRow = typeof t.ciInstallationEvents.$inferSelect;

const toRecord = (row: InstallationRow, events: EventRow[]): InstallationRecord => ({
  id: row.id,
  agentId: row.agentId,
  repo: row.repo,
  targetType: row.targetType,
  installedAt: row.installedAt,
  branch: row.branch,
  prUrl: row.prUrl,
  prNumber: row.prNumber,
  prState: row.prState ?? null,
  workflowVersion: row.workflowVersion,
  configHash: row.configHash,
  postAs: row.postAs,
  triggers: row.triggers,
  events: events.map((e) => ({
    id: e.id,
    action: e.action,
    at: e.at,
    templateVersion: e.templateVersion,
    outcome: e.outcome,
    prUrl: e.prUrl,
    error: e.error,
  })),
});

export class CiRepository implements CiRepositoryPort {
  constructor(private readonly db: Db) {}

  async getExportAgent(workspaceId: string, agentId: string): Promise<ExportAgent | null> {
    const [agent] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    if (!agent) return null;
    const skills = await this.db
      .select({ id: t.skills.id, name: t.skills.name, body: t.skills.body })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.skills.id, t.agentSkills.skillId))
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.skills.enabled, true),
          eq(t.skills.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(t.agentSkills.order), asc(t.skills.name));
    return {
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt,
      strategy: agent.strategy,
      ciFailOn: agent.ciFailOn,
      skills,
    };
  }

  async listMemoryForExport(workspaceId: string, repoId: string | null): Promise<MemoryRow[]> {
    const scopeFilter = repoId
      ? or(eq(t.memory.scope, 'global'), and(eq(t.memory.scope, 'repo'), eq(t.memory.repoId, repoId)))
      : eq(t.memory.scope, 'global');
    // No `embedding` column: it is never exported.
    return this.db
      .select({
        id: t.memory.id,
        scope: t.memory.scope,
        kind: t.memory.kind,
        content: t.memory.content,
      })
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), scopeFilter))
      .orderBy(desc(t.memory.createdAt), desc(t.memory.id));
  }

  async findRepoByFullName(workspaceId: string, fullName: string): Promise<ImportedRepo | null> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, defaultBranch: t.repos.defaultBranch })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)))
      .limit(1);
    return row ?? null;
  }

  private async assertAgent(workspaceId: string, agentId: string): Promise<void> {
    const [a] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    if (!a) throw new NotFoundError('Agent not found');
  }

  private async eventsFor(ids: string[]): Promise<Map<string, EventRow[]>> {
    const map = new Map<string, EventRow[]>();
    if (ids.length === 0) return map;
    const rows = await this.db
      .select()
      .from(t.ciInstallationEvents)
      .where(inArray(t.ciInstallationEvents.installationId, ids))
      .orderBy(desc(t.ciInstallationEvents.at), desc(t.ciInstallationEvents.id));
    for (const r of rows) {
      const list = map.get(r.installationId) ?? [];
      list.push(r);
      map.set(r.installationId, list);
    }
    return map;
  }

  async upsertInstallation(
    workspaceId: string,
    agentId: string,
    v: InstallationUpsert,
  ): Promise<InstallationRecord> {
    await this.assertAgent(workspaceId, agentId);
    const values = {
      workflowVersion: v.workflowVersion,
      configHash: v.configHash,
      postAs: v.postAs,
      triggers: v.triggers,
      prUrl: v.prUrl,
      prNumber: v.prNumber,
      prState: v.prUrl ? ('open' as const) : null,
      prStateCheckedAt: new Date(),
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId, repo: v.repo, targetType: 'gha', ...values })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo, t.ciInstallations.targetType],
        set: values,
      })
      .returning();
    const events = await this.eventsFor([row!.id]);
    return toRecord(row!, events.get(row!.id) ?? []);
  }

  async insertEvent(workspaceId: string, installationId: string, v: EventInsert): Promise<void> {
    const [owned] = await this.db
      .select({ id: t.ciInstallations.id })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.ciInstallations.id, installationId), eq(t.agents.workspaceId, workspaceId)))
      .limit(1);
    if (!owned) throw new NotFoundError('Installation not found');
    await this.db.insert(t.ciInstallationEvents).values({
      installationId,
      action: v.action,
      templateVersion: v.templateVersion,
      configHash: v.configHash,
      outcome: v.outcome,
      prUrl: v.prUrl,
      error: v.error,
    });
  }

  async updateInstallationPr(
    workspaceId: string,
    installationId: string,
    v: { prState: 'open' | 'merged' | 'closed' | null; checkedAt: Date },
  ): Promise<void> {
    const owned = this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    await this.db
      .update(t.ciInstallations)
      .set({ prState: v.prState, prStateCheckedAt: v.checkedAt })
      .where(and(eq(t.ciInstallations.id, installationId), inArray(t.ciInstallations.agentId, owned)));
  }

  async listInstallations(workspaceId: string, agentId: string): Promise<InstallationRecord[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
    const events = await this.eventsFor(rows.map((r) => r.inst.id));
    return rows.map((r) => toRecord(r.inst, events.get(r.inst.id) ?? []));
  }

  async getInstallation(
    workspaceId: string,
    agentId: string,
    installationId: string,
  ): Promise<InstallationRecord | null> {
    const all = await this.listInstallations(workspaceId, agentId);
    return all.find((i) => i.id === installationId) ?? null;
  }

  async listWorkspaceInstallations(workspaceId: string): Promise<InstallationRecord[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
    return rows.map((r) => toRecord(r.inst, []));
  }

  async storedRunKeys(workspaceId: string, installationIds: string[]): Promise<StoredRunKey[]> {
    if (installationIds.length === 0) return [];
    const rows = await this.db
      .select({
        installationId: t.ciRuns.ciInstallationId,
        githubRunId: t.ciRuns.githubRunId,
        runAttempt: t.ciRuns.runAttempt,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          inArray(t.ciRuns.ciInstallationId, installationIds),
          isNotNull(t.ciRuns.githubRunId),
        ),
      );
    return rows.flatMap((r) =>
      r.installationId && r.githubRunId != null && r.runAttempt != null
        ? [{ installationId: r.installationId, githubRunId: r.githubRunId, runAttempt: r.runAttempt }]
        : [],
    );
  }

  async insertCiRun(
    workspaceId: string,
    values: { ci: CiRunInsert; agentRun: AgentRunInsert },
  ): Promise<boolean> {
    const { ci, agentRun } = values;
    try {
      await this.db.transaction(async (tx) => {
        const [owned] = await tx
          .select({ id: t.ciInstallations.id })
          .from(t.ciInstallations)
          .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
          .where(and(eq(t.ciInstallations.id, ci.ciInstallationId), eq(t.agents.workspaceId, workspaceId)))
          .limit(1);
        if (!owned) throw new NotFoundError('Installation not found');
        const [run] = await tx
          .insert(t.agentRuns)
          .values({
            workspaceId,
            agentId: agentRun.agentId,
            prId: null,
            ranAt: agentRun.ranAt,
            provider: agentRun.provider,
            model: agentRun.model,
            durationMs: agentRun.durationMs,
            costUsd: agentRun.costUsd,
            status: agentRun.status,
            error: agentRun.error,
            source: 'ci',
            kind: 'review',
            findingsCount: agentRun.findingsCount,
            blockers: agentRun.blockers,
          })
          .returning({ id: t.agentRuns.id });
        const inserted = await tx
          .insert(t.ciRuns)
          .values({
            ciInstallationId: ci.ciInstallationId,
            prNumber: ci.prNumber,
            ranAt: ci.ranAt,
            status: ci.status,
            findingsCount: ci.findingsCount,
            costUsd: ci.costUsd,
            githubUrl: ci.githubUrl,
            source: 'ci',
            githubRunId: ci.githubRunId,
            runAttempt: ci.runAttempt,
            verdict: ci.verdict,
            durationMs: ci.durationMs,
            agentRunId: run!.id,
            error: ci.error,
            blockers: ci.blockers,
          })
          .onConflictDoNothing()
          .returning({ id: t.ciRuns.id });
        // Duplicate attempt: roll the `agent_runs` insert back with the transaction.
        if (inserted.length === 0) throw new DuplicateRun();
      });
      return true;
    } catch (err) {
      if (err instanceof DuplicateRun) return false;
      throw err;
    }
  }

  async listCiRuns(workspaceId: string, f: CiRunsFilter): Promise<CiRunRecord[]> {
    const conds = [eq(t.agents.workspaceId, workspaceId), gte(t.ciRuns.ranAt, f.since)];
    if (f.agentId) conds.push(eq(t.ciInstallations.agentId, f.agentId));
    if (f.repo) conds.push(eq(t.ciInstallations.repo, f.repo));
    if (f.status) conds.push(eq(t.ciRuns.status, f.status));
    const rows = await this.db
      .select({
        run: t.ciRuns,
        repo: t.ciInstallations.repo,
        agentId: t.agents.id,
        agentName: t.agents.name,
        agentRunError: t.agentRuns.error,
        repoId: t.repos.id,
        prId: t.pullRequests.id,
        prNumber: t.pullRequests.number,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciInstallations.id, t.ciRuns.ciInstallationId))
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.ciRuns.agentRunId))
      .leftJoin(
        t.repos,
        and(eq(t.repos.fullName, t.ciInstallations.repo), eq(t.repos.workspaceId, workspaceId)),
      )
      .leftJoin(
        t.pullRequests,
        and(eq(t.pullRequests.repoId, t.repos.id), eq(t.pullRequests.number, t.ciRuns.prNumber)),
      )
      .where(and(...conds))
      .orderBy(desc(t.ciRuns.ranAt), desc(t.ciRuns.id))
      .limit(CI_RUNS_LIMIT);
    return rows.map((r) => ({
      id: r.run.id,
      ciInstallationId: r.run.ciInstallationId,
      agentId: r.agentId,
      agentName: r.agentName,
      repo: r.repo,
      prNumber: r.run.prNumber,
      ranAt: r.run.ranAt,
      status: r.run.status,
      verdict: r.run.verdict,
      findingsCount: r.run.findingsCount,
      blockers: r.run.blockers,
      costUsd: r.run.costUsd,
      durationMs: r.run.durationMs,
      githubUrl: r.run.githubUrl,
      githubRunId: r.run.githubRunId,
      runAttempt: r.run.runAttempt,
      error: r.run.error ?? r.agentRunError ?? null,
      prLink: r.prId && r.repoId && r.prNumber != null ? { repoId: r.repoId, number: r.prNumber } : null,
    }));
  }
}

