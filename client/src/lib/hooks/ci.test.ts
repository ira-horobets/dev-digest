import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("../api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: (...a: unknown[]) => put(...a) },
}));

import { useCiRuns, useCiPreview, useExportCi, useRefreshCiRuns, useSetCiFailOn, useAutoRefreshCiRuns } from "./ci";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, spy, wrapper };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
});

describe("ci hooks", () => {
  it("useCiRuns sends only the set filters", async () => {
    get.mockResolvedValue({ runs: [] });
    const { wrapper } = setup();
    renderHook(() => useCiRuns({ range: "7d", repo: "acme/api", agent_id: undefined }), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith("/ci/runs?range=7d&repo=acme%2Fapi");
  });

  it("useCiPreview is disabled without a repo and re-keys on its inputs", async () => {
    post.mockResolvedValue({ files: [] });
    const { wrapper } = setup();
    const { rerender } = renderHook(
      ({ repo }) => useCiPreview("a1", { repo, post_as: "none", triggers: ["opened"] }),
      { wrapper, initialProps: { repo: "" } },
    );
    expect(post).not.toHaveBeenCalled();
    rerender({ repo: "acme/api" });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/agents/a1/ci/preview", { repo: "acme/api", post_as: "none", triggers: ["opened"] });
  });

  it("useExportCi opts out of the global toast and invalidates the installations", async () => {
    post.mockResolvedValue({ pr_url: "u" });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useExportCi(), { wrapper });
    await result.current.mutateAsync({ agentId: "a1", input: { repo: "acme/api" } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["ci-installations", "a1"] });
  });

  it("useRefreshCiRuns invalidates the stored runs", async () => {
    post.mockResolvedValue({ ingested: 1, running: [], retry_at: null, errors: [] });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useRefreshCiRuns(), { wrapper });
    await result.current.mutateAsync();
    expect(post).toHaveBeenCalledWith("/ci/runs/refresh");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["ci-runs"] });
  });

  it("useSetCiFailOn saves ci_fail_on to the agent and invalidates the installations (AC-44)", async () => {
    put.mockResolvedValue({ id: "a1", ci_fail_on: "warning" });
    const { wrapper, spy } = setup();
    const { result } = renderHook(() => useSetCiFailOn("a1"), { wrapper });
    result.current.mutate("warning");
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["ci-installations", "a1"] }));
    expect(put).toHaveBeenCalledWith("/agents/a1", { ci_fail_on: "warning" });
  });

  describe("useAutoRefreshCiRuns", () => {
    const visibility = (v: "visible" | "hidden") =>
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
    afterEach(() => {
      vi.useRealTimers();
      visibility("visible");
    });

    it("ticks every 60 s while visible, not while hidden, rate-limited or disabled", () => {
      vi.useFakeTimers();
      const tick = vi.fn();
      const { rerender } = renderHook(
        ({ enabled, retryAt }) => useAutoRefreshCiRuns(tick, { enabled, retryAt }),
        { initialProps: { enabled: true, retryAt: null as string | null } },
      );
      act(() => vi.advanceTimersByTime(60_000));
      expect(tick).toHaveBeenCalledTimes(1);

      visibility("hidden");
      act(() => vi.advanceTimersByTime(120_000));
      expect(tick).toHaveBeenCalledTimes(1);
      visibility("visible");

      rerender({ enabled: true, retryAt: new Date(Date.now() + 5 * 60_000).toISOString() });
      act(() => vi.advanceTimersByTime(60_000));
      expect(tick).toHaveBeenCalledTimes(1);

      rerender({ enabled: false, retryAt: null });
      act(() => vi.advanceTimersByTime(180_000));
      expect(tick).toHaveBeenCalledTimes(1);
    });
  });
});
