import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type Query } from "@tanstack/react-query";
import { multiAgentKey, useLatestMultiAgentRun, useMultiAgentRun } from "./multi-agent";

afterEach(() => vi.unstubAllGlobals());

const wrap = (qc: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("multi-agent hooks", () => {
  it("polls every 4 s while the run is running and stops once it is done", async () => {
    const run = (status: string) => ({ id: "m1", status });
    const fetchMock = vi.fn(async () => json(200, run("running")));
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMultiAgentRun("m1"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.data?.status).toBe("running"));

    const query = qc.getQueryCache().find({ queryKey: multiAgentKey("m1") }) as Query;
    const interval = (query.options as unknown as { refetchInterval: (q: Query) => number | false }).refetchInterval;
    expect(interval(query)).toBe(4000);
    qc.setQueryData(multiAgentKey("m1"), run("done"));
    expect(interval(query)).toBe(false);
  });

  it("does not retry a 404 for the latest run", async () => {
    const fetchMock = vi.fn(async () => json(404, { error: { code: "not_found", message: "none" } }));
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient();
    const { result } = renderHook(() => useLatestMultiAgentRun("p1"), { wrapper: wrap(qc) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
