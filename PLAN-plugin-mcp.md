# Plan: plugin-mcp

## Goal

Let a plugin declare MCP servers once, in a tool-neutral file, and have `./install.sh` apply them to every selected agent: Zed, Copilot CLI, Claude Code, and Cursor. Today each tool's MCP config is edited by hand and they've drifted: Zed and Copilot have six servers, Claude and Cursor have none.

## Scope

In:

- A declaration format: `plugins/<plugin>/mcp/<name>.json`, one file per server, named by its filename.
- One Node script, `scripts/mcp/sync-mcp.mjs`, that renders each declaration for each tool and edits that tool's config with `jsonc-parser`. That keeps comments and formatting intact in Zed's JSONC settings and in the strict JSON files of the other tools. A single script means there's one implementation of conflict checks, pruning, backups, and atomic writes.
- Ownership tracking, so servers removed from a plugin are pruned from every tool, while servers added by hand are never touched.
- Installer integration, tests, and README updates.
- Moving the six existing servers (`slack-official`, `workiq`, `ado`, `enghub`, `atlas`, `linear`) into `plugins/microsoft/mcp/`.

Out:

- Servers that a tool connects to by URL (`"type": "http"`). Version one supports only the command form, where the tool launches a local process such as `mcp-remote` or `agency mcp`. A `url` key is rejected rather than silently ignored, so adding it later is a deliberate change.
- Per-server opt-outs for specific tools.
- Secrets. Declarations must not contain them; every current server signs in through Entra or OAuth.
- VS Code's own `mcp.json`, and porting `merge-settings.py` or `install.sh` to another language.

## Design

### Declaration

```json
{
  "command": "npx",
  "args": ["-y", "mcp-remote@0.1.38", "https://mcp.linear.app/mcp", "3119"],
  "env": {}
}
```

- `command` is a required string. `args` is an optional array of strings, and `env` an optional object of strings. Any other key fails validation.
- Names match `^[a-z0-9][a-z0-9_-]*$`. Two plugins declaring the same name fail the install before anything changes, like skills and scripts.
- `command` names the program, not where it's installed. A bare name such as `npx` or `agency` is resolved at install time against the `PATH` of the shell running `./install.sh`, and the tool configs get the absolute path. GUI apps may not inherit that `PATH`, so they need absolute paths, but plugin files don't. If you switch from mise to nvm, rerunning `./install.sh` updates every server.
- A bare name that isn't on `PATH` fails the install before anything changes, naming the server and the command.
- `command` may also be an absolute path, or start with `~/`, for programs that aren't on `PATH`. Those are used as given, after expanding `~/`. `args` and `env` are passed through unchanged.

### Rendering per tool

| Target | File (override env var) | Key | Entry |
| --- | --- | --- | --- |
| `zed` | `$ZED_HOME/settings.json` | `context_servers` | `{command, args, env}` |
| `copilot` | `$COPILOT_HOME/mcp-config.json` | `mcpServers` | `{type: "stdio", command, args, tools: ["*"]}`, plus `env` when not empty |
| `claude` | `~/.claude.json` | `mcpServers` | `{type: "stdio", command, args, env}` |
| `cursor` | `$CURSOR_HOME/mcp.json` | `mcpServers` | `{command, args, env}` |

Claude Code keeps user-scope MCP servers in `~/.claude.json`, not in `$CLAUDE_HOME`. Tests already point `HOME` at a temporary directory, so that path needs no separate override. Confirm each shape against the tool's current docs while implementing, and record any differences under Obstacles.

### Ownership, adoption, and pruning

- `$AGENTS_HOME/state/mcp.json` records, per target, the server names dotagents installed: `{"zed": ["ado", ...], ...}`.
- For each declared server, the tool's existing entry with the same name is handled in one of three ways:
  - **Recorded as managed:** replace it.
  - **Not managed, but equal to the rendered entry:** adopt it. Equality treats a missing `args` as `[]` and a missing `env` as `{}`.
  - **Not managed and different:** fail with the target, file, and server name. Never print values.
- Names that are recorded as managed but no longer declared are removed from the tool and from the state file.
- Only selected targets are synced or pruned.

### Writes

These match the guarantees `merge-settings.py` already documents:

- A `--check` mode parses every file and detects every conflict across all selected targets before anything changes.
- Changes are applied with `jsonc-parser`'s `modify` and `applyEdits`, then written to a temporary file beside the target and atomically renamed into place, keeping the file's permissions. New files use `0600`.
- A changed file first gets an owner-only `<file>.<random>.bak` backup. If the file changes between reading and replacing, the write is refused.
- A file that doesn't change is left untouched, including its modification time.
- A missing file is created with just its MCP key. Symlinked or malformed destinations are rejected.
- The state file is written only after every target succeeds.

### Installer

- Find `plugins/*/mcp/*.json` in plugin load order.
- If any exist and an MCP-capable target is selected, require `node` (18 or later) and `npm`, then run `npm ci` in `scripts/mcp` when `node_modules` is missing or older than `package-lock.json`. Fail before any mutation if they're missing, like the existing Python check.
- Run `sync-mcp.mjs --check` with the selected targets up front, then sync once at the end.
- An install with no declared servers doesn't need Node.

## Execution rules

- All work happens on the `plugin-mcp` branch. One plan, one branch, one commit per phase.
- Prefix every commit message with `plugin-mcp: `.
- For each phase: implement only its scope, run validation, fix failures, commit.
- Work around small obstacles and log them under Obstacles. Stop only if a fundamental assumption is wrong or a finding reshapes the effort.
- Log existing bugs found along the way under Found bugs. Fold in fixes that belong to this effort, save small unrelated fixes for their own branches, and leave nuanced ones unfixed for discussion.
- After the last phase: update docs and commit, delete this file and commit, open a pull request (draft where supported; ask first only if the repository is public), fix each small unrelated bug on its own branch from the base branch with its own pull request, then report results with every obstacle and workaround, every bug found and how it was handled, and how the user can try the changes.
- `plugins/microsoft` is a separate local repository. Phase 4's plugin changes are committed there, on its `main`, with the same `plugin-mcp: ` prefix. Only the dotagents side goes in this branch.

## Validation

```sh
npm --prefix scripts/mcp test
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
bash -n install.sh
```

All tests use temporary homes and override variables, never real app config.

## User steps

- **After phase 4:** quit Zed, Copilot CLI, Claude Code, and Cursor before the real install runs, then reopen them.
- **Every install:** run `./install.sh` from a terminal whose `PATH` has `npx` and `agency`. Agent shells may not have `agency`, in which case the install fails and says so.
- **After phase 4, in Claude Code and Cursor:** sign in when prompted. Slack and Linear open a browser through `mcp-remote` on ports `3118` and `3119`. If an `agency` server fails, run `agency mcp ado` once in a terminal to refresh the Entra token.

## Phases

### Phase 1: Declarations and rendering

- Add `scripts/mcp/` with a `package.json` that depends only on `jsonc-parser`, a committed `package-lock.json`, and a `test` script using `node --test`. Ignore `scripts/mcp/node_modules/` in git.
- Implement loading of plugin `mcp/` directories, validation (keys, types, names, duplicates across plugins), command resolution (bare names on `PATH`, absolute paths, `~/`), and a renderer for each target.
- Unit tests cover valid declarations, every validation error, resolution against a temporary `PATH` (found, missing, absolute, `~/`), and the rendered shape for each target.
- Done when `npm --prefix scripts/mcp test` passes.

### Phase 2: Config sync

- Implement the CLI: `sync-mcp.mjs [--check] --plugins <dir>... --targets <target>...`, with paths taken from the same environment overrides as `install.sh`.
- Implement JSONC editing, adoption and conflict handling, pruning against the state file, and the write guarantees above.
- Tests on temporary files cover:
  - Zed comments and unrelated keys survive.
  - Unchanged files keep their bytes and modification time.
  - Adopting an equal entry, and failing on a different one.
  - Pruning a removed server while leaving a hand-added one.
  - Creating missing files with `0600`.
  - Rejecting symlinks and malformed files.
  - `--check` writing nothing.
  - Backups being created with `0600`.

### Phase 3: Installer integration

- Wire discovery, the Node prerequisite, `npm ci`, the up-front `--check`, and the final sync into `install.sh`.
- Extend `tests/test_install.py`:
  - Servers reach all four temporary configs.
  - Removing a declaration prunes it.
  - A conflicting unmanaged entry fails before any instructions, skills, or settings change.
  - Cursor-only and Zed-only installs with no declarations still run without Node.

### Phase 4: Move the existing servers

- Add the six declarations to `plugins/microsoft/mcp/`, using bare `npx` and `agency` and otherwise matching today's Zed and Copilot entries.
- Resolved commands won't match the hand-written absolute paths in Zed and Copilot, so remove those six hand-added entries first. Back up each file, then delete only those keys while keeping comments. The first install then creates them as managed.
- Update `plugins/microsoft/rules/mcp-servers.md` so it says Zed, Copilot, Claude Code, and Cursor sessions all connect to these servers, and that the servers are declared in `plugins/microsoft/mcp/`.
- Commit in the `plugins/microsoft` repository.
- After the user closes the apps, run `sync-mcp.mjs --check` against the real configs for all four targets, then `./install.sh`. Confirm the following, and paste the relevant lines into the report:
  - All four tools have all six servers, with absolute command paths.
  - Zed's comments are intact.
  - Zed actually starts the servers. The resolved `npx` is a `#!/usr/bin/env node` script rather than mise's shim, so it needs `node` on Zed's `PATH`. If it fails, log it under Obstacles and propose a fix, such as also resolving `node` into the server's `env.PATH`, instead of reverting to hard-coded shim paths.

## Obstacles

- `jsonc-parser`'s `getNodeValue` returns objects with no prototype, which broke `deepStrictEqual` comparisons. `parseDocument` now round-trips values through `JSON` to get plain objects.
- `jsonc-parser`'s `modify` with formatting reflows the previous sibling's lines when inserting a property, which would reformat hand-added Zed servers. Without formatting, it puts the new property on the sibling's line. Its removal also deletes a line comment after the previous property. `setServer` now writes insertions and removals itself, one whole line at a time, matching the sibling's indentation and comma style. It falls back to `modify` for replacements, empty objects, and layouts it can't edit line by line.
- The state file is saved after each target is written, not once at the end. Otherwise, a failure on a later target would leave servers in earlier configs with no record that dotagents owns them.

## Found bugs
