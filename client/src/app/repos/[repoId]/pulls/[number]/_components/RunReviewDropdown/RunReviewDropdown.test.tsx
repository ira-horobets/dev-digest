import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../../../../../messages/en/prReview.json";
import runs from "../../../../../../../../messages/en/runs.json";

const push = vi.fn();
const startMulti = vi.fn();
const runSingle = vi.fn();
const AGENTS = [
  { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
  { id: "a2", name: "Style", model: "claude-x", enabled: true },
  { id: "a3", name: "Legacy", model: "gpt-4o", enabled: false },
];
const served: { latest: { id: string } | undefined } = { latest: undefined };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useParams: () => ({ repoId: "r1", number: "42" }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: AGENTS }) }));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: runSingle, isPending: false }),
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({
    data: {
      concurrency: 3,
      agents: [
        { agent_id: "a1", duration_ms: 20_000, cost_usd: 0.02, samples: 3 },
        { agent_id: "a2", duration_ms: 40_000, cost_usd: 0.04, samples: 3 },
        { agent_id: "a3", duration_ms: null, cost_usd: null, samples: 0 },
      ],
    },
  }),
  useStartMultiAgentRun: () => ({ mutateAsync: startMulti, isPending: false }),
  useLatestMultiAgentRun: (id: string | null) => ({ data: id ? served.latest : undefined }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

beforeEach(() => {
  push.mockReset();
  startMulti.mockReset().mockResolvedValue({ multi_run_id: "m9", pr_id: "pr1", runs: [] });
  runSingle.mockReset().mockResolvedValue({ runs: [{ run_id: "run1" }] });
  served.latest = undefined;
});
afterEach(cleanup);

const renderMenu = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview, runs }}>
      <RunReviewDropdown prId="pr1" />
    </NextIntlClientProvider>,
  );

describe("RunReviewDropdown", () => {
  it("lists every agent with model and estimate, preselects enabled ones, and starts a multi-agent run", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /run review/i }));

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[2]).not.toBeChecked();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
    expect(screen.getByText("~20s · $0.02")).toBeInTheDocument();
    expect(screen.getByText("no estimate yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    await waitFor(() => expect(startMulti).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/m9");
  });

  it("disables the multi button below 2 agents, runs one agent through /review, and offers Clear and Configure", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /run review/i }));

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (0)" })).toBeDisabled();
    await user.click(screen.getAllByRole("checkbox")[2]!);
    expect(screen.getByRole("button", { name: "Run multi-agent review (1)" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Run review" }));
    await waitFor(() => expect(runSingle).toHaveBeenCalledWith({ prId: "pr1", agentId: "a3" }));
    expect(startMulti).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /run review/i }));
    await user.click(screen.getByRole("button", { name: "Configure agents…" }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=42");
  });

  it("links to the latest multi-agent run when there is one", async () => {
    served.latest = { id: "m5" };
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /run review/i }));
    await user.click(screen.getByRole("button", { name: "Latest multi-agent run" }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/m5");
  });
});
