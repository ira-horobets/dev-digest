/**
 * multi-agent — Drizzle repository (ring 3a). Owns `multi_agent_runs` and
 * reads the `kind = 'review'` rows of `agent_runs` with their reviews and
 * findings. Every query is scoped by `workspace_id`.
 */
import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  AgentInfo,
  ChildFinding,
  ChildRun,
  CreatedMultiRun,
  EstimateRow,
  MultiAgentRepositoryPort,
  MultiRunData,
  ParentRow,
  PullInfo,
} from './ports.js';

export class MultiAgentRepository implements MultiAgentRepositoryPort {
  constructor(private readonly db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<PullInfo | undefined> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id, number: t.pullRequests.number })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async findAgents(workspaceId: string, ids: string[]): Promise<AgentInfo[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, ids)));
  }

  async createMultiRun(workspaceId: string, prId: string, agents: AgentInfo[]): Promise<CreatedMultiRun> {
    return this.db.transaction(async (tx) => {
      const [parent] = await tx.insert(t.multiAgentRuns).values({ workspaceId, prId }).returning();
      const full = await tx
        .select({ id: t.agents.id, provider: t.agents.provider, model: t.agents.model })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), inArray(t.agents.id, agents.map((a) => a.id))));
      const byId = new Map(full.map((a) => [a.id, a]));
      const runs: CreatedMultiRun['runs'] = [];
      for (const agent of agents) {
        const cfg = byId.get(agent.id);
        const [run] = await tx
          .insert(t.agentRuns)
          .values({
            workspaceId,
            agentId: agent.id,
            prId,
            kind: 'review',
            source: 'local',
            status: 'running',
            provider: cfg?.provider ?? null,
            model: cfg?.model ?? null,
            multiRunId: parent!.id,
          })
          .returning({ id: t.agentRuns.id });
        runs.push({ run_id: run!.id, agent_id: agent.id, agent_name: agent.name });
      }
      return { multiRunId: parent!.id, runs };
    });
  }

  async getMultiRun(workspaceId: string, id: string): Promise<MultiRunData | undefined> {
    const [row] = await this.db
      .select({ parent: t.multiAgentRuns, number: t.pullRequests.number })
      .from(t.multiAgentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.id, id)));
    return row ? this.load(workspaceId, row.parent, row.number) : undefined;
  }

  async latestForPull(workspaceId: string, prId: string): Promise<MultiRunData | undefined> {
    const [row] = await this.db
      .select({ parent: t.multiAgentRuns, number: t.pullRequests.number })
      .from(t.multiAgentRuns)
      .leftJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row ? this.load(workspaceId, row.parent, row.number) : undefined;
  }

  async listAgentIds(workspaceId: string): Promise<string[]> {
    const rows = await this.db.select({ id: t.agents.id }).from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    return rows.map((r) => r.id);
  }

  async estimateRows(workspaceId: string, sample: number): Promise<EstimateRow[]> {
    const ranked = this.db
      .select({
        agentId: t.agentRuns.agentId,
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
        rn: sql<number>`row_number() over (partition by ${t.agentRuns.agentId} order by ${t.agentRuns.ranAt} desc)`.as('rn'),
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.kind, 'review'),
          eq(t.agentRuns.status, 'done'),
          isNotNull(t.agentRuns.agentId),
        ),
      )
      .as('ranked');
    const rows = await this.db
      .select({ agentId: ranked.agentId, durationMs: ranked.durationMs, costUsd: ranked.costUsd })
      .from(ranked)
      .where(lte(ranked.rn, sample));
    return rows.map((r) => ({ agentId: r.agentId!, durationMs: r.durationMs, costUsd: r.costUsd }));
  }

  /** Children (review runs), each with its newest review and that review's findings. */
  private async load(
    workspaceId: string,
    parent: typeof t.multiAgentRuns.$inferSelect,
    prNumber: number | null,
  ): Promise<MultiRunData> {
    const parentRow: ParentRow = {
      id: parent.id,
      prId: parent.prId,
      prNumber,
      ranAt: parent.ranAt.toISOString(),
    };
    const runs = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(
          eq(t.agentRuns.multiRunId, parent.id),
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.kind, 'review'),
        ),
      );
    runs.sort((a, b) => (a.agentName ?? '').localeCompare(b.agentName ?? '') || a.run.id.localeCompare(b.run.id));
    if (runs.length === 0) return { parent: parentRow, children: [] };

    const runIds = runs.map((r) => r.run.id);
    const reviews = await this.db
      .select()
      .from(t.reviews)
      .where(and(inArray(t.reviews.runId, runIds), eq(t.reviews.workspaceId, workspaceId)))
      .orderBy(desc(t.reviews.createdAt));
    const newest = new Map<string, (typeof reviews)[number]>();
    for (const r of reviews) if (r.runId && !newest.has(r.runId)) newest.set(r.runId, r);

    const reviewIds = [...newest.values()].map((r) => r.id);
    const findingRows =
      reviewIds.length > 0 ? await this.db.select().from(t.findings).where(inArray(t.findings.reviewId, reviewIds)) : [];
    const byReview = new Map<string, ChildFinding[]>();
    for (const f of findingRows) {
      const list = byReview.get(f.reviewId) ?? [];
      list.push({
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        file: f.file,
        startLine: f.startLine,
        endLine: f.endLine,
        kind: f.kind,
      });
      byReview.set(f.reviewId, list);
    }

    const children: ChildRun[] = runs.map(({ run, agentName }) => {
      const review = newest.get(run.id);
      return {
        runId: run.id,
        agentId: run.agentId,
        agentName: agentName ?? null,
        provider: run.provider,
        model: run.model,
        status: run.status,
        error: run.error,
        durationMs: run.durationMs,
        costUsd: run.costUsd,
        review: review ? { verdict: review.verdict, score: review.score, summary: review.summary } : null,
        findings: review ? (byReview.get(review.id) ?? []) : [],
      };
    });
    return { parent: parentRow, children };
  }
}
