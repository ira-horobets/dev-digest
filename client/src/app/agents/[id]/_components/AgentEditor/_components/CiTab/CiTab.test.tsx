import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiInstallation } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";

const inst = (over: Partial<CiInstallation> = {}): CiInstallation => ({
  id: "i1",
  agent_id: "ag1",
  repo: "acme/api",
  target_type: "gha",
  installed_at: new Date().toISOString(),
  branch: "devdigest/ci",
  pr_url: "https://github.com/acme/api/pull/9",
  pr_number: 9,
  pr_state: "merged",
  pr_state_stale: false,
  workflow_version: "devdigest-ci/v1",
  post_as: "github_review",
  triggers: ["opened", "synchronize"],
  last_export_outcome: "succeeded",
  last_export_at: new Date().toISOString(),
  out_of_date: false,
  events: [
    { id: "e1", action: "update", at: new Date().toISOString(), template_version: "devdigest-ci/v1", outcome: "succeeded", pr_url: "https://github.com/acme/api/pull/9", error: null },
    { id: "e0", action: "install", at: new Date().toISOString(), template_version: "devdigest-ci/v1", outcome: "failed", pr_url: null, error: "boom" },
  ],
  ...over,
});

const state = { installations: [] as CiInstallation[], active: 0 };
const updateMutateAsync = vi.fn();
const failOnMutate = vi.fn();

vi.mock("@/lib/hooks/ci", () => ({
  useCiInstallations: () => ({
    data: { installations: state.installations, active_count: state.active },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateCiInstallation: () => ({ mutateAsync: updateMutateAsync }),
  useSetCiFailOn: () => ({ mutate: failOnMutate, isPending: false }),
  // wizard hooks (the wizard opens from this tab)
  useCiPreview: () => ({ data: undefined, isLoading: false, isError: false }),
  useCiSecrets: () => ({ data: undefined, isLoading: false }),
  useExportCi: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/core", () => ({ useRepos: () => ({ data: [{ id: "r1", full_name: "acme/api" }] }) }));

import { CiTab } from "./CiTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "m",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skill_count: 0,
  stats: { runs: 0, accept_rate: null, avg_cost_usd: null },
  enabled: true,
  version: 1,
};

function renderTab() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.installations = [];
  state.active = 0;
  updateMutateAsync.mockReset();
  failOnMutate.mockReset();
});
afterEach(cleanup);

describe("CiTab", () => {
  it("empty state: 'Not deployed to CI yet', Update disabled, Add to CI opens the wizard on step 1", async () => {
    const user = userEvent.setup();
    renderTab();
    expect(screen.getByRole("heading", { name: "CI deployment" })).toBeInTheDocument();
    expect(screen.getByText("Not deployed to CI yet")).toBeInTheDocument();
    expect(screen.getByText("Not active in any repo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "Add to CI" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Export to CI");
    expect(within(dialog).getByRole("list", { name: "Export steps" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /GitHub Actions/ })).toBeChecked();
  });

  it("lists installations with state, history and the active badge; Update is enabled only when out of date", async () => {
    const user = userEvent.setup();
    state.installations = [inst(), inst({ id: "i2", repo: "acme/web", pr_state: "open", pr_state_stale: true, out_of_date: true, events: [] })];
    state.active = 1;
    renderTab();

    expect(screen.getByText("Active in 1 repo")).toBeInTheDocument();
    expect(screen.getByText("acme/api")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR merged" })).toHaveAttribute("href", "https://github.com/acme/api/pull/9");
    expect(screen.getAllByText("workflow devdigest-ci/v1")).toHaveLength(2);
    expect(screen.getByText("could not refresh")).toBeInTheDocument();
    expect(screen.getByText("out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "+ Add repository" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "History" })[0]!);
    const history = screen.getByRole("list", { name: "History" });
    expect(within(history).getByText("Update")).toBeInTheDocument();
    expect(within(history).getByText("Install")).toBeInTheDocument();
    expect(within(history).getByText("boom")).toBeInTheDocument();
  });

  it("Update CI config lists only out-of-date repos, warns about overwrites, and updates after confirmation", async () => {
    const user = userEvent.setup();
    state.installations = [inst(), inst({ id: "i2", repo: "acme/web", out_of_date: true })];
    updateMutateAsync.mockResolvedValue({ installation: inst(), pr_url: "u", error: null });
    renderTab();

    await user.click(screen.getByRole("button", { name: "Update CI config" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("acme/web")).toBeInTheDocument();
    expect(within(dialog).queryByText("acme/api")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/will be overwritten/)).toBeInTheDocument();
    expect(updateMutateAsync).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Update 1 repo" }));
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledWith({ agentId: "ag1", installationId: "i2" }));
    expect(await within(dialog).findByText("updated")).toBeInTheDocument();
  });

  it("Fail CI on is bound to the agent's ci_fail_on and saves through the hook (AC-43, AC-44)", async () => {
    const user = userEvent.setup();
    state.installations = [inst()];
    renderTab();
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("critical");
    await user.selectOptions(select, "warning");
    expect(failOnMutate).toHaveBeenCalledWith("warning");
  });
});
