#!/usr/bin/env bash
# Prepare the job's checkout for autoreview: fetch and push as the posting identity.
# Swaps actions/checkout's auth header for a token in origin's URL, and names commits after
# the token's user. Reads PUSH_TOKEN, GITHUB_SERVER_URL, GITHUB_REPOSITORY and GITHUB_WORKSPACE.
set -euo pipefail

cd "$GITHUB_WORKSPACE"
server="${GITHUB_SERVER_URL%/}"

# Ask the server who the token belongs to; the built-in Actions token has no user
response="$(curl -sS -w '\n%{http_code}' -H "Authorization: token $PUSH_TOKEN" "$server/api/v1/user" 2>&1 || true)"
status="${response##*$'\n'}"
login="$(printf '%s' "${response%$'\n'*}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["login"])' 2>/dev/null || true)"
if [[ "$status" != 200 || -z "$login" ]]; then
  echo "autoreview: couldn't look up the token's user at $server/api/v1/user (HTTP $status: ${response%$'\n'*})" >&2
  echo "autoreview: a bot token needs the read:user scope; committing as autoreview" >&2
  login=autoreview
fi
host="${server#*://}"

# actions/checkout authenticates with a header, which would override the URL's token
git config --local --unset-all "http.$server/.extraheader" || true
git remote set-url origin "${server%%://*}://$login:$PUSH_TOKEN@$host/$GITHUB_REPOSITORY.git"

# Commits carry the poster's name, with the server's no-reply address
git config --local user.name "$login"
git config --local user.email "$login@noreply.$host"
echo "autoreview: git fetches, pushes and commits as $login"
