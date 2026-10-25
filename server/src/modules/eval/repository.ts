import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type {
  EvalCaseMeta,
  EvalCaseOutcome,
  EvalExpectation,
  EvalOwnerKind,
  EvalRunScope,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Eval data-access. Owns `eval_cases` and `eval_runs`; reads the
 * finding → review → pull_request chain and `pr_files` ONLY to freeze a
 * case's input at creation time (a case never points back at them).
 * Workspace-scoped throughout.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff: string;
  inputFiles: string[];
  inputMeta: EvalCaseMeta;
  expectation: EvalExpectation;
  notes?: string | null;
  sourceFindingId?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  notes?: string | null;
  inputDiff?: string;
  inputFiles?: string[];
  inputMeta?: EvalCaseMeta;
  expectation?: EvalExpectation;
}

export interface InsertEvalRun {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  scope: EvalRunScope;
  agentVersion: number | null;
  caseIds: string[];
}

export interface CompleteEvalRun {
  status: 'completed' | 'errored';
  perCase: EvalCaseOutcome[];
  casesErrored: number;
  tracesPassed: number | null;
  tracesTotal: number | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  costUsd: number | null;
  errorReason?: string | null;
}

/** Everything case creation needs about a finding, joined in one read. */
export interface FindingForCase {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  agentId: string | null;
  prId: string;
  prNumber: number;
  prTitle: string;
  prBody: string | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- cases ---------------------------------------------------------------

  async insertCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputFiles: values.inputFiles,
        inputMeta: values.inputMeta,
        expectedOutput: values.expectation,
        notes: values.notes ?? null,
        sourceFindingId: values.sourceFindingId ?? null,
      })
      .returning();
    return row!;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async getCaseBySourceFinding(
    workspaceId: string,
    findingId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.sourceFindingId, findingId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return row;
  }

  async listCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(t.evalCases.createdAt);
  }

  /** Case counts per owner id across the workspace (dashboard rows). */
  async countCasesByOwner(workspaceId: string, ownerKind: EvalOwnerKind): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ ownerId: t.evalCases.ownerId })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, ownerKind)));
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.ownerId, (counts.get(r.ownerId) ?? 0) + 1);
    return counts;
  }

  async updateCase(workspaceId: string, id: string, patch: UpdateEvalCase): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectation !== undefined ? { expectedOutput: patch.expectation } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Deletes the case row only — past runs keep their stored outcomes. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- source finding (freeze-time reads only) ------------------------------

  async findingForCase(workspaceId: string, findingId: string): Promise<FindingForCase | undefined> {
    const [row] = await this.db
      .select({
        finding: {
          id: t.findings.id,
          file: t.findings.file,
          startLine: t.findings.startLine,
          endLine: t.findings.endLine,
          severity: t.findings.severity,
          category: t.findings.category,
          title: t.findings.title,
          acceptedAt: t.findings.acceptedAt,
          dismissedAt: t.findings.dismissedAt,
        },
        agentId: t.reviews.agentId,
        prId: t.pullRequests.id,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
        prBody: t.pullRequests.body,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .where(and(eq(t.findings.id, findingId), eq(t.pullRequests.workspaceId, workspaceId)));
    return row;
  }

  /** The stored patch (hunks only) of one file on a PR, if any. */
  async filePatch(prId: string, path: string): Promise<string | null> {
    const [row] = await this.db
      .select({ patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, prId), eq(t.prFiles.path, path)));
    return row?.patch ?? null;
  }

  // ---- runs ----------------------------------------------------------------

  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        scope: values.scope,
        agentVersion: values.agentVersion,
        caseIds: values.caseIds,
        status: 'running',
      })
      .returning();
    return row!;
  }

  async getRun(workspaceId: string, id: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, id)));
    return row;
  }

  async getRuns(workspaceId: string, ids: string[]): Promise<EvalRunRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), inArray(t.evalRuns.id, ids)));
  }

  /** All runs of one owner, newest first; optionally only those since `since`. */
  async listRunsForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
    since?: Date,
  ): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.ownerKind, ownerKind),
          eq(t.evalRuns.ownerId, ownerId),
          ...(since ? [gte(t.evalRuns.ranAt, since)] : []),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
  }

  /** Recent SUITE runs across every owner in the workspace (dashboard table). */
  async listRecentRuns(workspaceId: string, limit: number): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.scope, 'suite')))
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }

  /** Every run in the workspace of one kind, newest first (dashboard rows). */
  async listRunsForKind(workspaceId: string, ownerKind: EvalOwnerKind): Promise<EvalRunRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.ownerKind, ownerKind)))
      .orderBy(desc(t.evalRuns.ranAt));
  }

  async activeRunForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.ownerKind, ownerKind),
          eq(t.evalRuns.ownerId, ownerId),
          eq(t.evalRuns.status, 'running'),
        ),
      );
    return row;
  }

  async completeRun(id: string, values: CompleteEvalRun): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({
        status: values.status,
        perCase: values.perCase,
        casesErrored: values.casesErrored,
        tracesPassed: values.tracesPassed,
        tracesTotal: values.tracesTotal,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd,
        errorReason: values.errorReason ?? null,
        finishedAt: new Date(),
      })
      .where(eq(t.evalRuns.id, id));
  }

  /** `running` rows older than `cutoff` → `errored` (restart / outage). */
  async reconcileStaleRunning(
    cutoff: Date,
    scope: { workspaceId: string; ownerKind: EvalOwnerKind; ownerId: string },
  ): Promise<number> {
    const rows = await this.db
      .update(t.evalRuns)
      .set({
        status: 'errored',
        errorReason: 'Run did not finish (server restart or provider outage).',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(t.evalRuns.status, 'running'),
          lt(t.evalRuns.ranAt, cutoff),
          eq(t.evalRuns.workspaceId, scope.workspaceId),
          eq(t.evalRuns.ownerKind, scope.ownerKind),
          eq(t.evalRuns.ownerId, scope.ownerId),
        ),
      )
      .returning({ id: t.evalRuns.id });
    return rows.length;
  }
}
