#!/usr/bin/env bash
# PreToolUse guard (Edit|Write) for the read-only agents that write only their
# own report. Usage in frontmatter:  report-paths.sh <agent>
#
#   planner                docs/plans/<kebab>.md (the plan is its report)
#   researcher             .pipeline/<slug>/brief.md, .pipeline/<slug>/researcher[-<kebab>].md
#   architecture-reviewer  .pipeline/<slug>/architecture-reviewer.md|.findings.json
#   plan-verifier          .pipeline/<slug>/plan-verifier.md|.findings.json
#
# <slug> is the plan file name without .md (feat-intent-layer), or a kebab name
# for work without a plan. .pipeline/ is git-ignored and outside the
# verification fingerprint, so reports never make a verify result stale.
# Paths are normalised (`..`). Exit 2 + stderr = block.
set -euo pipefail

agent="${1:-}"
payload="$(cat)"
file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')"
[[ -n "$file" ]] || exit 0

root="$(realpath -m -- "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}")"
[[ "$file" == /* ]] || file="$root/$file"
abs="$(realpath -m -- "$file")"
rel="${abs#"$root"/}"

deny() {
  echo "$agent: blocked write to '$rel' — $1. You write only your own report; everything else goes in it." >&2
  exit 2
}

[[ "$rel" != "$abs" ]] || deny "path is outside the repository"

slug='[a-z0-9]+(-[a-z0-9]+)*'
case "$agent" in
  planner)
    [[ "$rel" =~ ^docs/plans/${slug}\.md$ ]] && exit 0
    deny "the planner writes only docs/plans/<kebab>.md" ;;
  researcher)
    [[ "$rel" =~ ^\.pipeline/${slug}/(brief|researcher(-${slug})?)\.md$ ]] && exit 0
    deny "the researcher writes only .pipeline/<slug>/brief.md or researcher[-<topic>].md" ;;
  architecture-reviewer | plan-verifier)
    [[ "$rel" =~ ^\.pipeline/${slug}/${agent}(\.md|\.findings\.json)$ ]] && exit 0
    deny "the $agent writes only .pipeline/<slug>/$agent.md and .findings.json" ;;
  *)
    deny "report-paths.sh: unknown agent '$agent'" ;;
esac
