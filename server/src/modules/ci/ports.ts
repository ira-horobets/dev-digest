/**
 * ci — ports (ring 1). Interfaces and plain DTOs only: the repository port the
 * services use, and the structural subset of the GitHub client they need.
 */
import type { GitHubClient } from '@devdigest/shared';

export interface ExportSkill {
  id: string;
  name: string;
  body: string;
}

export interface ExportAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  strategy: 'auto' | 'single-pass' | 'map-reduce';
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
  /** Enabled links to enabled skills, in link order. */
  skills: ExportSkill[];
}

export interface MemoryRow {
  id: string;
  scope: string;
  kind: string;
  content: string;
}

export interface ImportedRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
}

export interface InstallationEventRecord {
  id: string;
  action: 'install' | 'update';
  at: Date;
  templateVersion: string | null;
  outcome: 'succeeded' | 'failed';
  prUrl: string | null;
  error: string | null;
}

export interface InstallationRecord {
  id: string;
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  installedAt: Date;
  branch: string;
  prUrl: string | null;
  prNumber: number | null;
  prState: 'open' | 'merged' | 'closed' | null;
  workflowVersion: string | null;
  configHash: string | null;
  postAs: 'github_review' | 'pr_comment' | 'none';
  triggers: string[];
  events: InstallationEventRecord[];
}

export interface InstallationUpsert {
  repo: string;
  configHash: string;
  workflowVersion: string;
  postAs: 'github_review' | 'pr_comment' | 'none';
  triggers: string[];
  prUrl: string | null;
  prNumber: number | null;
}

export interface EventInsert {
  action: 'install' | 'update';
  templateVersion: string | null;
  configHash: string | null;
  outcome: 'succeeded' | 'failed';
  prUrl: string | null;
  error: string | null;
}

export interface StoredRunKey {
  installationId: string;
  githubRunId: number;
  runAttempt: number;
}

export interface CiRunInsert {
  ciInstallationId: string;
  prNumber: number | null;
  ranAt: Date;
  status: 'succeeded' | 'failed' | 'no_findings';
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string;
  githubRunId: number;
  runAttempt: number;
  verdict: string | null;
  durationMs: number | null;
  error: string | null;
  blockers: number | null;
}

export interface AgentRunInsert {
  agentId: string;
  ranAt: Date;
  provider: string;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  status: 'done' | 'failed';
  error: string | null;
  findingsCount: number | null;
  blockers: number | null;
}

export interface CiRunRecord {
  id: string;
  ciInstallationId: string | null;
  agentId: string | null;
  agentName: string | null;
  repo: string;
  prNumber: number | null;
  ranAt: Date | null;
  status: string | null;
  verdict: string | null;
  findingsCount: number | null;
  blockers: number | null;
  costUsd: number | null;
  durationMs: number | null;
  githubUrl: string | null;
  githubRunId: number | null;
  runAttempt: number | null;
  error: string | null;
  prLink: { repoId: string; number: number } | null;
}

export interface CiRunsFilter {
  since: Date;
  agentId?: string;
  repo?: string;
  status?: string;
}

export interface CiRepositoryPort {
  getExportAgent(workspaceId: string, agentId: string): Promise<ExportAgent | null>;
  listMemoryForExport(workspaceId: string, repoId: string | null): Promise<MemoryRow[]>;
  findRepoByFullName(workspaceId: string, fullName: string): Promise<ImportedRepo | null>;
  upsertInstallation(
    workspaceId: string,
    agentId: string,
    values: InstallationUpsert,
  ): Promise<InstallationRecord>;
  insertEvent(workspaceId: string, installationId: string, values: EventInsert): Promise<void>;
  updateInstallationPr(
    workspaceId: string,
    installationId: string,
    values: { prState: 'open' | 'merged' | 'closed' | null; checkedAt: Date },
  ): Promise<void>;
  listInstallations(workspaceId: string, agentId: string): Promise<InstallationRecord[]>;
  getInstallation(
    workspaceId: string,
    agentId: string,
    installationId: string,
  ): Promise<InstallationRecord | null>;
  listWorkspaceInstallations(workspaceId: string): Promise<InstallationRecord[]>;
  storedRunKeys(workspaceId: string, installationIds: string[]): Promise<StoredRunKey[]>;
  /** One transaction: `agent_runs` then `ci_runs`; false (and nothing stored) on a duplicate key. */
  insertCiRun(
    workspaceId: string,
    values: { ci: CiRunInsert; agentRun: AgentRunInsert },
  ): Promise<boolean>;
  listCiRuns(workspaceId: string, filter: CiRunsFilter): Promise<CiRunRecord[]>;
}

export type CiGitHubPort = Pick<
  GitHubClient,
  | 'getRepoInfo'
  | 'getOptionalFileContent'
  | 'listActionsSecretNames'
  | 'listWorkflowRuns'
  | 'downloadArtifact'
  | 'getPullState'
  | 'commitFiles'
  | 'findOpenPr'
  | 'openPullRequest'
>;

export interface CiDeps {
  repo: CiRepositoryPort;
  github: () => Promise<CiGitHubPort>;
  hasGithubToken: () => Promise<boolean>;
  runnerBundle: () => Promise<string>;
  now: () => Date;
}
