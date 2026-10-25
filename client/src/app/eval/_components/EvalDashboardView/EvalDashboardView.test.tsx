import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/eval",
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const state = vi.hoisted(() => ({ data: null as EvalDashboard | null, isLoading: false, isError: false }));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: state.data, isLoading: state.isLoading, isError: state.isError, refetch: vi.fn() }),
  useRunAllEvals: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  push.mockReset();
});

const run = (id: string, agentId: string, agentName: string, version: number, recall: number, passed: number, total: number): EvalRunRecord => ({
  id,
  owner_kind: "agent",
  owner_id: agentId,
  agent_name: agentName,
  scope: "suite",
  status: "completed",
  started_at: "2026-05-29T09:14:00Z",
  finished_at: "2026-05-29T09:15:00Z",
  agent_version: version,
  case_ids: [],
  metrics: { recall, precision: 0.91, citation_accuracy: 0.95, traces_passed: passed, traces_total: total, cases_errored: 0, duration_ms: 1000, cost_usd: 0.23, per_case: [] },
  duration_ms: 1000,
  cost_usd: 0.23,
  error_reason: null,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("renders one row per agent with its latest metrics and the recent-runs table", () => {
    const latest = run("r7", "ag1", "Security Reviewer", 7, 0.82, 17, 20);
    state.data = {
      agents: [
        {
          agent_id: "ag1",
          agent_name: "Security Reviewer",
          provider: "openai",
          model: "gpt-4.1",
          version: 7,
          enabled: true,
          cases_total: 20,
          runs_total: 5,
          latest,
          trend: [
            { run_id: "r6", ran_at: "2026-05-27T16:40:00Z", agent_version: 6, recall: 0.78, precision: 0.93, citation_accuracy: 0.94, pass_rate: 0.8, cost_usd: 0.21 },
            { run_id: "r7", ran_at: "2026-05-29T09:14:00Z", agent_version: 7, recall: 0.82, precision: 0.91, citation_accuracy: 0.95, pass_rate: 0.85, cost_usd: 0.23 },
          ],
        },
        { agent_id: "ag2", agent_name: "Custom Mentor", provider: "openai", model: "gpt-4o-mini", version: 2, enabled: false, cases_total: 0, runs_total: 0, latest: null, trend: [] },
      ],
      recent_runs: [latest, run("r6", "ag1", "Security Reviewer", 6, 0.78, 16, 20)],
    };
    renderView();

    expect(screen.getByText("Eval Dashboard")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText(/17\/20 pass/)).toBeInTheDocument();
    expect(screen.getByText("No eval cases yet · never run")).toBeInTheDocument();
    // the recent-runs table lists both runs with their version
    expect(screen.getByText("v7")).toBeInTheDocument();
    expect(screen.getByText("v6")).toBeInTheDocument();
    expect(screen.getByText("16/20")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Security Reviewer" }));
    expect(push).toHaveBeenCalledWith("/eval/agents/ag1");
  });

  it("opens the run-all confirmation with the execution estimate", () => {
    state.data = {
      agents: [
        { agent_id: "ag1", agent_name: "Security Reviewer", provider: "openai", model: "gpt-4.1", version: 7, enabled: true, cases_total: 5, runs_total: 0, latest: null, trend: [] },
        { agent_id: "ag2", agent_name: "Performance Reviewer", provider: "openai", model: "gpt-4o", version: 4, enabled: true, cases_total: 3, runs_total: 0, latest: null, trend: [] },
      ],
      recent_runs: [],
    };
    renderView();
    expect(screen.getByText("No eval runs yet. Create a case from a triaged finding and run it.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Run all agents"));
    expect(screen.getByText("Run every agent's eval set?")).toBeInTheDocument();
    expect(screen.getByText("This runs 2 agents across 8 case executions. Cost and duration vary by provider.")).toBeInTheDocument();
  });
});
