import type {
  AgentRunInsert,
  CiRepositoryPort,
  CiRunInsert,
  CiRunRecord,
  CiRunsFilter,
  EventInsert,
  ExportAgent,
  ImportedRepo,
  InstallationRecord,
  InstallationUpsert,
  MemoryRow,
  StoredRunKey,
} from '../../src/modules/ci/ports.js';

export const WS = 'ws-1';

export const exportAgent = (over: Partial<ExportAgent> = {}): ExportAgent => ({
  id: 'agent-1',
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'Review.',
  strategy: 'auto',
  ciFailOn: 'critical',
  skills: [{ id: 's1', name: 'Rule', body: 'Body' }],
  ...over,
});

/** In-memory CiRepositoryPort. */
export class FakeCiRepo implements CiRepositoryPort {
  agent: ExportAgent | null = exportAgent();
  repos: ImportedRepo[] = [{ id: 'repo-1', fullName: 'acme/api', defaultBranch: 'main' }];
  memory: MemoryRow[] = [];
  installations: InstallationRecord[] = [];
  events: (EventInsert & { installationId: string })[] = [];
  runs: { ci: CiRunInsert; agentRun: AgentRunInsert }[] = [];
  prStates: Record<string, string | null> = {};
  private seq = 0;

  async getExportAgent(_ws: string, agentId: string) {
    return this.agent && this.agent.id === agentId ? this.agent : null;
  }
  async listMemoryForExport(_ws: string, _repoId: string | null) {
    return this.memory;
  }
  async findRepoByFullName(_ws: string, fullName: string) {
    return this.repos.find((r) => r.fullName === fullName) ?? null;
  }
  async upsertInstallation(_ws: string, agentId: string, v: InstallationUpsert) {
    let rec = this.installations.find((i) => i.agentId === agentId && i.repo === v.repo);
    if (!rec) {
      rec = {
        id: `inst-${++this.seq}`,
        agentId,
        repo: v.repo,
        targetType: 'gha',
        installedAt: new Date('2026-10-31T00:00:00Z'),
        branch: 'devdigest/ci',
        prUrl: null,
        prNumber: null,
        prState: null,
        workflowVersion: null,
        configHash: null,
        postAs: v.postAs,
        triggers: v.triggers,
        events: [],
      };
      this.installations.push(rec);
    }
    Object.assign(rec, {
      configHash: v.configHash,
      workflowVersion: v.workflowVersion,
      postAs: v.postAs,
      triggers: v.triggers,
      prUrl: v.prUrl,
      prNumber: v.prNumber,
      prState: v.prUrl ? 'open' : null,
    });
    return rec;
  }
  async insertEvent(_ws: string, installationId: string, v: EventInsert) {
    this.events.push({ ...v, installationId });
    const rec = this.installations.find((i) => i.id === installationId);
    rec?.events.unshift({
      id: `ev-${++this.seq}`,
      action: v.action,
      at: new Date('2026-10-31T00:00:00Z'),
      templateVersion: v.templateVersion,
      outcome: v.outcome,
      prUrl: v.prUrl,
      error: v.error,
    });
  }
  async updateInstallationPr(_ws: string, id: string, v: { prState: 'open' | 'merged' | 'closed' | null }) {
    const rec = this.installations.find((i) => i.id === id);
    if (rec) rec.prState = v.prState;
  }
  async listInstallations(_ws: string, agentId: string) {
    return this.installations.filter((i) => i.agentId === agentId);
  }
  async getInstallation(_ws: string, agentId: string, id: string) {
    return this.installations.find((i) => i.agentId === agentId && i.id === id) ?? null;
  }
  async listWorkspaceInstallations(_ws: string) {
    return this.installations;
  }
  async storedRunKeys(_ws: string, _ids: string[]): Promise<StoredRunKey[]> {
    return this.runs.map((r) => ({
      installationId: r.ci.ciInstallationId,
      githubRunId: r.ci.githubRunId,
      runAttempt: r.ci.runAttempt,
    }));
  }
  async insertCiRun(_ws: string, v: { ci: CiRunInsert; agentRun: AgentRunInsert }) {
    const dup = this.runs.some(
      (r) =>
        r.ci.ciInstallationId === v.ci.ciInstallationId &&
        r.ci.githubRunId === v.ci.githubRunId &&
        r.ci.runAttempt === v.ci.runAttempt,
    );
    if (dup) return false;
    this.runs.push(v);
    return true;
  }
  async listCiRuns(_ws: string, _f: CiRunsFilter): Promise<CiRunRecord[]> {
    return [];
  }
}
