#!/usr/bin/env bash
# Run dotagents' installer for the composite action in action.yml.
# Copies the CONFIG file into place, lets git use TOKEN for the server's repositories during
# this install only, then runs install.sh --runner with the space-separated TARGETS.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Use the given plugin list, resolved against the workspace like other action paths
if [[ -n "${CONFIG:-}" ]]; then
  config="$CONFIG"
  [[ "$config" == /* ]] || config="${GITHUB_WORKSPACE:-$PWD}/$config"
  cp "$config" "$REPO_ROOT/dotagents.jsonc"
fi

# Authenticate HTTPS clones from this server, and rewrite its SSH URLs to HTTPS
if [[ -n "${TOKEN:-}" ]]; then
  server="${GITHUB_SERVER_URL:-https://github.com}"
  host="${server#https://}"
  header="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"
  echo "::add-mask::${header#AUTHORIZATION: basic }"
  export GIT_CONFIG_COUNT=2
  export GIT_CONFIG_KEY_0="http.$server/.extraheader" GIT_CONFIG_VALUE_0="$header"
  export GIT_CONFIG_KEY_1="url.$server/.insteadOf" GIT_CONFIG_VALUE_1="git@$host:"
fi

read -ra targets <<< "${TARGETS:-}"
exec "$REPO_ROOT/install.sh" --runner ${targets[@]+"${targets[@]}"}
