import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCompare, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../../lib/toast";

const updateAgent = vi.fn();
const state = vi.hoisted(() => ({ compare: null as EvalCompare | null, currentPrompt: "" }));
vi.mock("../../../../../../lib/hooks/eval", () => ({
  useEvalCompare: () => ({ data: state.compare, isLoading: false, isError: false }),
}));
vi.mock("../../../../../../lib/hooks/agents", () => ({
  useAgent: () => ({ data: { id: "ag1", name: "Security Reviewer", system_prompt: state.currentPrompt, version: 8 } }),
  useUpdateAgent: () => ({ mutate: updateAgent, isPending: false }),
}));

import { CompareModal } from "./CompareModal";

afterEach(() => {
  cleanup();
  updateAgent.mockReset();
});

const run = (id: string, version: number, recall: number, precision: number, cost: number): EvalRunRecord => ({
  id,
  owner_kind: "agent",
  owner_id: "ag1",
  agent_name: "Security Reviewer",
  scope: "suite",
  status: "completed",
  started_at: "2026-05-29T09:14:00Z",
  finished_at: null,
  agent_version: version,
  case_ids: ["c1", "c2"],
  metrics: { recall, precision, citation_accuracy: 0.94, traces_passed: 16, traces_total: 20, cases_errored: 0, duration_ms: 1, cost_usd: cost, per_case: [] },
  duration_ms: 1,
  cost_usd: cost,
  error_reason: null,
});

const OLD = "You are a security-focused PR reviewer.\nReturn at most 5 findings ranked by severity.\nEvery finding MUST cite file and line.";
const NEW = "You are a security-focused PR reviewer.\nReturn at most 5 findings ranked by severity.\nFlag unused imports as suggestions.\nEvery finding MUST cite file and line.";

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <ToastProvider>
        <CompareModal agentId="ag1" a="r6" b="r7" onClose={() => {}} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("CompareModal", () => {
  it("shows old → new metrics with deltas, the flipped cases and the prompt diff", () => {
    state.compare = {
      a: run("r6", 6, 0.78, 0.93, 0.21),
      b: run("r7", 7, 0.82, 0.91, 0.23),
      deltas: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01, cost_usd: 0.02 },
      common_case_ids: ["c1", "c2"],
      only_in_a: [],
      only_in_b: [],
      case_transitions: [{ case_id: "c2", name: "missing-retry-after", from: true, to: false }],
      prompt_a: OLD,
      prompt_b: NEW,
      prompt_diff: [
        { kind: "context", text: "You are a security-focused PR reviewer." },
        { kind: "context", text: "Return at most 5 findings ranked by severity." },
        { kind: "added", text: "Flag unused imports as suggestions." },
        { kind: "context", text: "Every finding MUST cite file and line." },
      ],
    };
    state.currentPrompt = OLD; // the agent is NOT on v7's prompt → promote is offered
    renderModal();

    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("4pt")).toBeInTheDocument();
    expect(screen.getByText("2pt")).toBeInTheDocument();
    expect(screen.getByText("$0.23")).toBeInTheDocument();
    expect(screen.getByText("missing-retry-after now fails")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-diff")).toHaveTextContent("Flag unused imports as suggestions.");

    fireEvent.click(screen.getByText("Promote v7"));
    expect(updateAgent).toHaveBeenCalledWith({ id: "ag1", patch: { system_prompt: NEW } }, expect.anything());
  });

  it("disables promote when the newer prompt is already the current one", () => {
    state.compare = {
      ...state.compare!,
      prompt_diff: state.compare!.prompt_diff,
    };
    state.currentPrompt = NEW;
    renderModal();
    expect(screen.getByText("v7 is the current prompt").closest("button")).toBeDisabled();
  });
});
