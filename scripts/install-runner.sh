#!/usr/bin/env bash
# Install dotagents on a CI runner, for action.yml: agent homes go under RUNNER_TEMP, and their
# paths are exported through GITHUB_ENV so later steps' agents pick up the instructions.
# Takes the install.sh targets as arguments (default: copilot).
set -euo pipefail

# Keep the runner's own homes untouched
export CURSOR_HOME="$RUNNER_TEMP/dotagents/cursor" ZED_HOME="$RUNNER_TEMP/dotagents/zed"
export CLAUDE_HOME="$RUNNER_TEMP/dotagents/claude" COPILOT_HOME="$RUNNER_TEMP/dotagents/copilot"
export AGENTS_HOME="$RUNNER_TEMP/dotagents/agents"
if [[ "$#" -eq 0 ]]; then
  set -- copilot
fi
"$(dirname "${BASH_SOURCE[0]}")/../install.sh" "$@"

# Point later steps at the installed homes
for name in CURSOR_HOME ZED_HOME CLAUDE_HOME COPILOT_HOME AGENTS_HOME; do
  echo "$name=${!name}" >> "$GITHUB_ENV"
done
