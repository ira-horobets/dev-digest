import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import runs from "../../../../../../../messages/en/runs.json";
import shell from "../../../../../../../messages/en/shell.json";

const push = vi.fn();
const replace = vi.fn();
const startMulti = vi.fn();
const state: { pr: string | null; agents: unknown[]; pulls: unknown[] } = { pr: null, agents: [], pulls: [] };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => ({ get: (k: string) => (k === "pr" ? state.pr : null) }),
  usePathname: () => "/repos/r1/multi-agent",
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/api" } }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => ({ data: state.pulls }) }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: state.agents }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({
    data: {
      concurrency: 3,
      agents: [
        { agent_id: "a1", duration_ms: 20_000, cost_usd: 0.02, samples: 3 },
        { agent_id: "a2", duration_ms: null, cost_usd: null, samples: 0 },
      ],
    },
  }),
  useStartMultiAgentRun: () => ({ mutateAsync: startMulti, isPending: false }),
}));

import { ConfigureRunView } from "./ConfigureRunView";

const pull = (number: number, status: string) => ({ id: `pr${number}`, number, title: `Title ${number}`, status });
const agent = (id: string, name: string, enabled = true) => ({ id, name, description: `${name} reviews`, model: "m", enabled });

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  startMulti.mockReset().mockResolvedValue({ multi_run_id: "m1", pr_id: "pr7", runs: [] });
  state.pr = null;
  state.pulls = [pull(7, "open"), pull(8, "merged"), pull(9, "closed")];
  state.agents = [agent("a1", "Security"), agent("a2", "Style"), agent("a3", "Legacy", false)];
});
afterEach(cleanup);

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ runs, shell }}>
      <ConfigureRunView repoId="r1" />
    </NextIntlClientProvider>,
  );

describe("ConfigureRunView", () => {
  it("without a PR shows the placeholder and no Run; picking a PR writes ?pr=", async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.getByText("Choose which PR to review above, then select the agents to run on it.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run multi-agent review/ })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Run a Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pull request" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agents to run" })).toBeInTheDocument();

    await user.click(screen.getByText("Select a pull request"));
    expect(screen.getByText("#7 · Title 7")).toBeInTheDocument();
    expect(screen.getByText("#8 · Title 8")).toBeInTheDocument();
    expect(screen.queryByText("#9 · Title 9")).not.toBeInTheDocument(); // closed PRs are not offered
    await user.click(screen.getByText("#8 · Title 8"));
    expect(replace).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=8");
  });

  it("with a PR shows a card per agent with estimates and the total, Select all, and starts the run", async () => {
    state.pr = "7";
    const user = userEvent.setup();
    renderView();

    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.getByText("Security reviews")).toBeInTheDocument();
    expect(screen.getByText("disabled")).toBeInTheDocument();
    expect(screen.getAllByText("no estimate yet").length).toBeGreaterThan(0);
    expect(screen.getByText(/parallel fan-out/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Security" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("(partial)")).toBeInTheDocument(); // the selected Style agent has no estimate
    expect(screen.queryByText(/Already merged/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (3)" })).toBeEnabled();
    await user.click(screen.getAllByRole("checkbox")[1]!);
    await user.click(screen.getAllByRole("checkbox")[2]!);
    expect(screen.getByRole("button", { name: "Run multi-agent review (1)" })).toBeDisabled();
    await user.click(screen.getAllByRole("checkbox")[2]!);

    await user.click(screen.getByRole("button", { name: "Run multi-agent review (2)" }));
    await waitFor(() => expect(startMulti).toHaveBeenCalledWith({ prId: "pr7", agentIds: ["a1", "a3"] }));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/m1");
  });

  it("warns for a merged or closed PR but still allows the run", () => {
    state.pr = "8";
    renderView();
    expect(screen.getByText("Already merged — review is informational")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeEnabled();
    cleanup();
    state.pr = "9";
    renderView();
    expect(screen.getByText("Already merged — review is informational")).toBeInTheDocument();
  });

  it("shows an empty state linking to /agents when the workspace has no agents", () => {
    state.agents = [];
    state.pr = "7";
    renderView();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agents" })).toHaveAttribute("href", "/agents");
  });
});
