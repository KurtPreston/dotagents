#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURSOR_HOME="${CURSOR_HOME:-$HOME/.cursor}"

mkdir -p "$CURSOR_HOME"

link_dir() {
  local name="$1"
  local source="$REPO_ROOT/.cursor/$name"
  local target="$CURSOR_HOME/$name"

  if [[ ! -d "$source" ]]; then
    echo "error: missing source directory $source" >&2
    exit 1
  fi

  if [[ -e "$target" && ! -L "$target" ]]; then
    echo "error: $target exists and is not a symlink — move or remove it first" >&2
    exit 1
  fi

  ln -sfn "$source" "$target"
  echo "linked $target -> $source"
}

link_dir rules
link_dir skills

echo "done"
