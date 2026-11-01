import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/runs.json";
import { EstimateLabel } from "./EstimateLabel";

afterEach(cleanup);

const renderLabel = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={{ runs: messages }}>{ui}</NextIntlClientProvider>);

describe("EstimateLabel", () => {
  it("shows duration and cost, a partial marker, and 'no estimate yet' instead of zeros", () => {
    const { rerender } = renderLabel(<EstimateLabel durationMs={80_000} costUsd={0.012} />);
    expect(screen.getByTestId("estimate-label")).toHaveTextContent("~1m 20s · $0.012");
    expect(screen.queryByText("(partial)")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <EstimateLabel durationMs={80_000} costUsd={0.012} partial />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("(partial)")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <EstimateLabel durationMs={null} costUsd={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("no estimate yet")).toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });
});
