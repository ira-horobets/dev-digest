import type { CiPostAs, CiTrigger } from "@devdigest/shared";

/** Wizard steps in order; labels resolve under `ci.exportWizard.steps`. */
export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;

export const TRIGGER_VALUES: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
export const DEFAULT_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize"];

export const POST_AS_VALUES: readonly CiPostAs[] = ["github_review", "pr_comment", "none"];
export const DEFAULT_POST_AS: CiPostAs = "github_review";

/** i18n key suffix per post-as value. */
export const POST_AS_LABEL_KEY: Record<CiPostAs, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

export const MODAL_WIDTH = 760;
export const ZIP_FILENAME = "devdigest-ci.zip";
export const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";
export const SUPPORTED_PROVIDER = "openrouter";

/** GitHub's "Using secrets in GitHub Actions" page. */
export const DOCS_URL = "https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions";
