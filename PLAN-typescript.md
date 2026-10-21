# Plan: typescript

## Goal

Move every part of dotagents to TypeScript, run directly by Node, with one toolchain. Python is removed, and `install.sh` becomes a thin Bash wrapper around `scripts/install.ts`. The whole repository, including `autoreview/`, shares one `package.json`, one lockfile, one Node requirement, and one set of TypeScript, lint, and format settings. See `docs/best-practices.md`.

## Scope

In:

- A root `package.json`, `package-lock.json`, `tsconfig.json`, `.oxlintrc.json`, and `.oxfmtrc.json`. These replace `autoreview/`'s copies and `scripts/mcp/package.json`. The versions and settings are `autoreview`'s: Node `>=22.18`, TypeScript 5.9.3, `@types/node` 22, `oxlint`, `oxfmt`, and `node --test`. `jsonc-parser` is the only runtime dependency.
- Converting `scripts/mcp/*.mjs` to TypeScript.
- Replacing `scripts/merge-settings.py` with a TypeScript settings overlay built on the same JSON-editing code as the MCP sync. It changes only the overlay's keys and no longer reformats the file. This visible change is accepted.
- Porting `tests/test_settings.py` and `tests/test_install.py` to `node:test` in TypeScript, covering the same behavior.
- Moving `install.sh`'s logic into `scripts/install.ts`. `./install.sh` stays the entry point: it checks for Node 22.18+, runs `npm ci` when `node_modules` is missing or older than the lockfile, and then runs `node scripts/install.ts "$@"`.

Out:

- `autoreview/*.sh` and the plugins' Bash scripts.
- Changes to `autoreview`'s behavior, other than running it with the shared tooling.
- Changes to the settings overlays' contents or the MCP declaration format.

Visible changes:

- Every install needs Node 22.18+ and npm. Cursor-only and Zed-only installs used to need only Bash. Python is no longer needed.
- Settings overlays are applied as minimal edits, so the settings files aren't reformatted.
- The installer installs the full set of dependencies, including development tools, rather than only `jsonc-parser`. That's simpler, and running `./install.sh` never removes the tools tests need.

## Design

### Layout

```
install.sh               Bash wrapper: Node check, npm ci when stale, exec node
scripts/install.ts       Entry point: targets, plugins, preflight, then mutations
scripts/lib/json.ts      Strict JSON and JSONC parsing (from scripts/mcp/json.mjs)
scripts/lib/files.ts     Snapshots, owner-only backups, atomic replace
scripts/lib/edit.ts      Minimal jsonc-parser edits (setServer and friends, generalized)
scripts/settings.ts      Settings overlay: recursive merge as minimal edits
scripts/mcp/*.ts         Declarations, targets, sync
tests/*.test.ts          Unit and installer tests
autoreview/src, test     Unchanged code, using the root tooling
```

Adjust the module split as needed while implementing, and record notable changes under Obstacles.

### Settings overlay semantics

These stay the same:

- Overlay objects merge recursively. Scalars and arrays replace the existing value. `null` is a literal value, not a deletion.
- An overlay object that conflicts with a non-object value fails, naming the key path.
- Overlay keys that aren't in the file are added. Values are never printed.
- Strict JSON only, for both overlay and destination. Malformed files, duplicate keys, non-object roots, empty files, and symlinked destinations are all rejected.
- A missing destination is created as `0600`. An unchanged file isn't rewritten. A changed file gets an owner-only `<file>.<random>.bak` backup and is replaced atomically, keeping its permissions. The write is refused if the file changed after it was read.

### Installer

- `scripts/install.ts` keeps the current order. Everything is validated first: targets, the `AGENTS.md` marker, duplicate skills, scripts, and MCP servers, settings overlays and destinations, and MCP commands and conflicts. Only then does anything change: `AGENTS.md`, adapters, links, settings, and MCP servers.
- Output lines and error messages keep their current forms (`linked`, `generated`, `validated`, `updated`, `unchanged`, `backup`, and `error: …`) unless a message names Python.
- The wrapper's checks are the only work done before Node takes over. It fails with `error:` and changes nothing if Node is missing or too old, or if npm is missing when dependencies are stale.
- Running `npm ci` changes only the repository's `node_modules`, not any agent's configuration.

### `autoreview`

- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format:check` run from the repository root and cover `scripts/`, `tests/`, and `autoreview/`.
- `autoreview/action.yml` and `templates/npm-setup.yml` keep `node-version: 22`, which satisfies `>=22.18`. The action's `install.sh copilot` step now runs `npm ci` through the wrapper, and needs nothing else.

## Execution rules

- All work happens on the `typescript` branch. One plan, one branch, one commit per phase.
- Prefix every commit message with `typescript: `.
- For each phase: implement only its scope, run validation, fix failures, commit.
- Work around small obstacles and log them under Obstacles. Stop only if a fundamental assumption is wrong or a finding reshapes the effort.
- Log existing bugs found along the way under Found bugs. Fold in fixes that belong to this effort, save small unrelated fixes for their own branches, and leave nuanced ones unfixed for discussion.
- After the last phase: update docs and commit, delete this file and commit, open a pull request (draft where supported; ask first only if the repository is public), fix each small unrelated bug on its own branch from the base branch with its own pull request, then report results with every obstacle and workaround, every bug found and how it was handled, and how the user can try the changes.
- Read `docs/best-practices.md` before each phase.

## Validation

From phase 1 on:

```sh
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
bash -n install.sh
```

Until phase 3 removes them, also run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`. All tests use temporary homes and override variables, never real app config.

## User steps

- **After the merge:** delete the leftover `autoreview/node_modules/` and `scripts/mcp/node_modules/` folders. Git ignores them, so the branch can't remove them. The agent can do this on this machine once the work is merged.
- **When changing machines:** install Node 22.18+ before running `./install.sh`. Python is no longer needed.

## Phases

### Phase 1: One toolchain

- Move `autoreview/package.json`'s development dependencies and scripts, `tsconfig.json`, `.oxlintrc.json`, and `.oxfmtrc.json` to the repository root, merged with `scripts/mcp/package.json`'s `jsonc-parser` dependency. Generate one root lockfile, and delete `autoreview/`'s and `scripts/mcp/`'s package files and lockfiles.
- Set `include` to `scripts`, `tests`, and `autoreview`. Ignore `node_modules/` at the root, and keep the template ignores in `.oxfmtrc.json`.
- Run `autoreview`'s tests from the root, fixing any paths that assumed `autoreview/` as the working directory.
- Convert `scripts/mcp/*.mjs` to `.ts` with types, and move their tests to `tests/mcp-*.test.ts`.
- Point `install.sh` at `node scripts/mcp/sync-mcp.ts` and the root `npm ci`. Update `tests/test_install.py`'s MCP fixture to match.
- Run `oxfmt` across everything the tools now cover, so later phases start from a formatted tree.

### Phase 2: Settings in TypeScript

- Extract the shared code into `scripts/lib/` (`json.ts`, `files.ts`, and `edit.ts`), and move the MCP sync onto it.
- Implement `scripts/settings.ts` with the semantics above, plus a temporary CLI (`[--check] <overlay> <destination>`) so the Bash installer can call it until phase 4.
- Port `tests/test_settings.py` to `tests/settings.test.ts`, adding cases showing that unrelated formatting and comments in unrelated values survive.
- Switch `install.sh` from `python3 merge-settings.py` to the Node CLI, replacing the Python check with a Node check. Delete `scripts/merge-settings.py` and `tests/test_settings.py`.
- Update `tests/test_install.py`: its allowlisted `PATH` provides `node` instead of `python3`, and its missing-Python tests become missing-Node tests.

### Phase 3: Installer tests in TypeScript

- Port `tests/test_install.py` to `tests/install.test.ts`, keeping every case and the same fixture approach: a copied repository, temporary homes, an allowlisted `PATH`, and `node_modules` symlinked from the checkout. Then delete it; no Python remains.
- These tests run `./install.sh` as a separate process, so they keep working unchanged through phase 4.

### Phase 4: Installer in TypeScript

- Implement `scripts/install.ts`, ported from `install.sh`, calling `settings.ts` and the MCP sync directly.
- Replace `install.sh` with the wrapper. Remove the temporary settings CLI and `sync-mcp.ts`'s CLI if nothing else uses them.
- Add wrapper tests: a missing `node`, a fake `node` reporting an older version, and stale dependencies with no `npm`. Each fails with `error:` and changes nothing.
- Run the real install from a login shell. It should report `unchanged` for every settings and MCP file, apart from any formatting-only differences the new overlay writes. Record what changed in the report.

## Obstacles

## Found bugs
