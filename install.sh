#!/usr/bin/env bash
# Install dotagents. Checks for Node 22.18 or later, installs dependencies when they're
# missing or older than the lockfile, then runs scripts/install.ts with the same arguments.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Node runs the installer's TypeScript directly, which needs 22.18 or later
version="$(command -v node >/dev/null 2>&1 && node -p 'process.versions.node' 2>/dev/null || true)"
IFS=. read -r major minor _ <<< "${version:-0.0.0}"
if (( major < 22 || (major == 22 && minor < 18) )); then
  echo "error: dotagents requires Node 22.18 or later${version:+ (found $version)}; install node and rerun ./install.sh" >&2
  exit 1
fi

# Install dependencies into the repository when missing or older than the lockfile
if [[ ! -e "$REPO_ROOT/node_modules/.package-lock.json" \
    || "$REPO_ROOT/package-lock.json" -nt "$REPO_ROOT/node_modules/.package-lock.json" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "error: npm is needed to install dotagents' dependencies; install npm and rerun ./install.sh" >&2
    exit 1
  fi
  (cd "$REPO_ROOT" && npm ci --no-audit --no-fund --silent)
fi

exec node "$REPO_ROOT/scripts/install.ts" "$@"
