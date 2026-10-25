import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Every assertion is checked against
 * the TRACE — actual tool calls and files read — never against what the model says it did.
 * "I invoked the reviewer" in the answer text is not evidence of a dispatch.
 *
 * Tool policy: every session that reads the live repository runs on the read-only allow-list
 * (WORKFLOW_ALLOWED_TOOLS = Read, Grep, Glob, Task, Agent, Skill). No Bash, no Write, no Edit —
 * none of these cases needs them, and a fresh model session with write access to the real tree is
 * a risk the eval must not take.
 *
 * Budget: 7 Claude sessions.
 *   - 1 × dispatch                                      = 1
 *   - 1 × contrast (treatment in repo + control in tmp) = 2
 *   - 2 × trace                                         = 2
 *   - 1 × activation pair (positive + near-miss)        = 2
 */
export const cases: WorkflowCase[] = [
  // --- dispatch (1 session): an architecture-review task must spawn the subagent --------------
  // The endpoint must NOT already exist, or the model reviews existing code inline instead of
  // delegating. GET /reviews/:id/export is genuinely absent from routes.ts. The plan is spelled
  // out inline: the first run of this case asked for a review of "my plan" without giving one,
  // and the model spent its single turn asking for the plan instead of dispatching (0 tool calls).
  // Pass = the trace holds an Agent/Task call whose subagent_type is architecture-reviewer.
  {
    kind: "dispatch",
    name: "architecture-review task dispatches the architecture-reviewer subagent",
    prompt:
      "Here is my plan for a NEW, not yet implemented endpoint GET /reviews/:id/export that " +
      "returns a review as markdown:\n" +
      "1. server/src/modules/reviews/routes.ts — add the GET handler; it validates `id` with Zod " +
      "and calls ReviewService.exportMarkdown(id).\n" +
      "2. server/src/modules/reviews/service.ts — add exportMarkdown(id): loads the review via " +
      "ReviewRepository.findById and renders markdown with a small pure helper in domain/.\n" +
      "3. No new dependencies; the service is wired in platform/container.ts as today.\n" +
      "Dispatch the architecture-reviewer subagent now to assess this plan against the onion " +
      "layers and DI rules. Do not review it yourself and do not ask me for more detail — the " +
      "plan above is complete.",
    expectSubagent: "architecture-reviewer",
    maxTurns: 8,
  },

  // --- contrast (2 sessions): isolate CLAUDE.md's contribution --------------------------------
  // Treatment runs in the real repo with the project harness loaded; control runs the SAME prompt
  // in an empty temp directory with no on-disk config. Pass = treatment reads api-contracts.md
  // AND control does not. This is the only case kind that proves the "Read When" row in
  // CLAUDE.md, rather than the model's general instincts, is what routes the read.
  {
    kind: "contrast",
    name: "CLAUDE.md 'Read When' routes an API-route task to api-contracts.md",
    prompt:
      "I am about to add a new API route to this repository. Before touching code, follow this " +
      "repo's guidance on which documentation to read for API route changes, and read exactly " +
      "that document.",
    expectFileRead: "server/docs/api-contracts.md",
    maxTurns: 6,
  },

  // --- trace (1 session): a second "Read When" row ---------------------------------------------
  // Tests routing, so the prompt pushes toward CONSULTING the docs, not exploring source. Earlier
  // phrasing ("figure out how it all works") sent the model straight into schema.ts and
  // pipeline/run.ts and it never opened the routed doc. One anchor doc keeps this deterministic.
  {
    kind: "trace",
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "I am going to change the review pipeline. Before touching code, check this repo's " +
      "guidance (CLAUDE.md) on which documentation must be read for pipeline changes, and read " +
      "exactly those documents.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): "Hit unexpected behavior" routing -> gotchas ------------------------
  // Was a contrast case, but a control run in an empty tmpdir can still reach the real repo by
  // absolute path and read gotchas.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "In reviewer-core I hit unexpected behaviour — something does not work the way I expected. " +
      "According to this repo's guidance, where might this already be documented? Read that file.",
    expectFilesRead: ["reviewer-core/insights/gotchas.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ----------------------------
  // Activation = a Skill tool call for engineering-insights, or a Read of its SKILL.md — from the
  // trace. The negative shares the topic (pgvector dimensions) so a keyword match would fire, but
  // it is a request for an explanation, not a discovery to record.
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Just figured out why the pgvector query returned zero rows — the column dimension no " +
      "longer matched after we switched the embedding model. I want to record this so we do not " +
      "step on it again.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Explain how column dimensions work in pgvector and why a mismatch returns zero rows.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
