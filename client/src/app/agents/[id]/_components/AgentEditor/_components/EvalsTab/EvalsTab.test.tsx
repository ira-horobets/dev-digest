import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalAgentDetail, EvalCase, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const startRun = vi.fn();
const hooks = vi.hoisted(() => ({
  cases: [] as EvalCase[],
  detail: null as EvalAgentDetail | null,
  runs: [] as EvalRunRecord[],
}));
vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: hooks.cases, isLoading: false }),
  useEvalAgentDetail: () => ({ data: hooks.detail }),
  useEvalRuns: () => ({ data: hooks.runs }),
  useStartEvalRun: () => ({ mutate: startRun, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  startRun.mockReset();
  push.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 7,
  stats: { runs: 0, accept_rate: null, avg_cost_usd: null },
  skill_count: 0,
};

const CASE = (id: string, name: string, type: "must_find" | "must_not_flag"): EvalCase => ({
  id,
  owner_kind: "agent",
  owner_id: "ag1",
  name,
  input_diff: "diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,1 +10,2 @@\n a\n+b",
  input_files: ["src/config.ts"],
  input_meta: { pr_number: 482, title: "Add Stripe", body: null },
  expectation: { type, file: "src/config.ts", start_line: 11, end_line: 11, severity: "CRITICAL", category: "security", title: name },
  source_finding_id: null,
  notes: null,
  created_at: "2026-05-29T09:14:00Z",
  updated_at: "2026-05-29T09:14:00Z",
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <EvalsTab agent={AGENT} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("shows the empty state and n/a tiles when the agent has no cases", () => {
    hooks.cases = [];
    hooks.detail = null;
    hooks.runs = [];
    renderTab();
    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(3);
    // nothing to run yet
    expect(screen.getByText("Run all evals").closest("button")).toBeDisabled();
  });

  it("renders metrics with deltas, the passing badge and per-case outcomes", () => {
    hooks.cases = [CASE("c1", "stripe-key-leak", "must_find"), CASE("c2", "clean-refactor-no-flags", "must_not_flag"), CASE("c3", "service-role-in-client", "must_find")];
    hooks.detail = {
      agent_id: "ag1",
      agent_name: "Security Reviewer",
      provider: "openai",
      model: "gpt-4.1",
      version: 7,
      cases_total: 3,
      runs: [],
      trend: [],
      current: {
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        cases_errored: 0,
        duration_ms: 1000,
        cost_usd: 0.23,
        per_case: [],
      },
      current_version: 7,
      delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
      callout: null,
      case_outcomes: {
        c1: { case_id: "c1", name: "stripe-key-leak", expectation_type: "must_find", status: "scored", pass: true, error_reason: null, findings_total: 1, findings_matched: 1, grounding_kept: 1, grounding_total: 1, duration_ms: 1800, cost_usd: 0.02, actual: [] },
        c2: { case_id: "c2", name: "clean-refactor-no-flags", expectation_type: "must_not_flag", status: "scored", pass: false, error_reason: null, findings_total: 1, findings_matched: 1, grounding_kept: 1, grounding_total: 1, duration_ms: 1200, cost_usd: 0.02, actual: [] },
      },
    };
    hooks.runs = [];
    renderTab();

    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText("17/20")).toBeInTheDocument();
    expect(screen.getByText("4pt")).toBeInTheDocument();
    expect(screen.getByText("2pt")).toBeInTheDocument();
    expect(screen.getByText("1 / 3 passing")).toBeInTheDocument();

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 1")).toBeInTheDocument();
    expect(screen.getByText("expected 0 findings, got 1")).toBeInTheDocument();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.getByText("empty []")).toBeInTheDocument();
    expect(screen.getAllByText("CRITICAL · security")).toHaveLength(2);
  });

  it("runs the whole suite, a single case, and opens the editor", () => {
    hooks.cases = [CASE("c1", "stripe-key-leak", "must_find")];
    hooks.detail = null;
    hooks.runs = [];
    renderTab();

    fireEvent.click(screen.getByText("Run all evals"));
    expect(startRun).toHaveBeenCalledWith({ agentId: "ag1", caseIds: undefined }, expect.anything());

    fireEvent.click(screen.getByLabelText("Run this case"));
    expect(startRun).toHaveBeenLastCalledWith({ agentId: "ag1", caseIds: ["c1"] }, expect.anything());

    fireEvent.click(screen.getByText("New eval case"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Finding skeleton"));
    expect(screen.getByText("valid JSON")).toBeInTheDocument();

    fireEvent.click(screen.getByText("View full dashboard →"));
    expect(push).toHaveBeenCalledWith("/eval/agents/ag1");
  });

  it("disables running while a run is in flight", () => {
    hooks.cases = [CASE("c1", "stripe-key-leak", "must_find")];
    hooks.detail = null;
    hooks.runs = [
      { id: "r1", owner_kind: "agent", owner_id: "ag1", agent_name: "Security Reviewer", scope: "suite", status: "running", started_at: "2026-05-29T09:14:00Z", finished_at: null, agent_version: 7, case_ids: ["c1"], metrics: null, duration_ms: null, cost_usd: null, error_reason: null },
    ];
    renderTab();
    expect(screen.getByText("Running…", { selector: "button" })).toBeDisabled();
  });
});
