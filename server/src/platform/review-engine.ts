/**
 * The review engine lives in @devdigest/reviewer-core (shared with the CI
 * agent-runner). Only platform/*, modules/reviews/* and the shared contracts
 * may import it directly (`reviewer-core-boundary` in .dependency-cruiser.cjs);
 * this thin re-export shim is how another module — the eval pipeline — runs
 * the SAME engine over a frozen diff without crossing that boundary.
 */
export {
  reviewPullRequest,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewEvent,
} from '@devdigest/reviewer-core';
