import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room.
    testTimeout: 240_000,
    hookTimeout: 240_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    // EVAL_SEQUENTIAL=1 (CI tool tiers) runs files one at a time — OpenRouter throttles bursts
    // and a throttled session degrades to a single turn, which reads as a false dispatch miss.
    fileParallelism: !process.env.EVAL_SEQUENTIAL,
    // EVAL_RETRY=n re-runs a failed case n times (CI tool tiers use 1). Every attempt is recorded.
    retry: Number(process.env.EVAL_RETRY ?? "0"),
    reporters: ["default", new TrendReporter(), ...(process.env.GITHUB_ACTIONS ? ["github-actions" as const] : [])],
  },
});
