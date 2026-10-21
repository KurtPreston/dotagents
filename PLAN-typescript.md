# Plan: typescript

## Goal

Move every part of dotagents to TypeScript, run directly by Node, with one toolchain. Python is removed, and `install.sh` becomes a thin Bash wrapper around `scripts/install.ts`. The repository has one `package.json`, one lockfile, one Node requirement, and one set of TypeScript, lint, and format settings. See `docs/best-practices.md`.

## Scope

In:

- A root `package.json`, `package-lock.json`, `tsconfig.json`, `.oxlintrc.json`, and `.oxfmtrc.json`, replacing `scripts/mcp/package.json`. They use the versions and settings the former `autoreview` package used: Node `>=22.18`, TypeScript 5.9.3, `@types/node` 22, `oxlint`, `oxfmt`, and `node --test`. `jsonc-parser` is the only runtime dependency.
- Converting `scripts/mcp/*.mjs` to TypeScript.
- Replacing `scripts/merge-settings.py` with a TypeScript settings overlay built on the same JSON-editing code as the MCP sync. It changes only the overlay's keys and no longer reformats the file; that visible change is accepted.
- Porting `tests/test_settings.py` and `tests/test_install.py` to `node:test` in TypeScript, keeping the same behavior.
- Moving `install.sh`'s logic into `scripts/install.ts`. `./install.sh` stays the entry point: it checks for Node 22.18+, runs `npm ci` when `node_modules` is missing or older than the lockfile, then runs `node scripts/install.ts "$@"`.
- Folding `scripts/install-runner.sh` into the installer as `./install.sh --runner [targets]`. `action.yml` calls that, and the Bash script is deleted.

Out:

- The plugins' Bash scripts.
- Changes to the settings overlays' contents or to the MCP declaration format.
- Setting up Node inside `action.yml`. The runner must provide Node 22.18+, as it used to provide `python3`, for example with `actions/setup-node` in an earlier step. Running `setup-node` inside the action would change the Node version for the job's later steps.

Visible changes:

- Every install needs Node 22.18+ and npm. Cursor-only and Zed-only installs used to need only Bash. Python is no longer needed, including on runners.
- Settings overlays are applied as minimal edits, so the settings files aren't reformatted.
- The installer installs all dependencies, including development tools. That's simpler, and running `./install.sh` never removes tools the tests need.

## Design

### Layout

```
install.sh               Bash wrapper: Node check, npm ci when stale, exec node
action.yml               Runs ./install.sh --runner with the given targets
scripts/install.ts       Entry point: targets, runner mode, plugins, preflight, then mutations
scripts/lib/json.ts      Strict JSON and JSONC parsing (from scripts/mcp/json.mjs)
scripts/lib/files.ts     Snapshots, owner-only backups, atomic replace
scripts/lib/edit.ts      Minimal jsonc-parser edits (setServer and friends, generalized)
scripts/settings.ts      Settings overlay: recursive merge as minimal edits
scripts/mcp/*.ts         Declarations, targets, sync
tests/*.test.ts          Unit and installer tests
```

Adjust the module split as needed while implementing, and record notable changes under Obstacles.

### Settings overlay semantics

These stay the same:

- Overlay objects merge recursively. Scalars and arrays replace the existing value. `null` is a literal value, not a deletion.
- An overlay object that conflicts with a non-object value fails, naming the key path. Overlay keys missing from the file are added. Values are never printed.
- Overlay and destination must both be strict JSON. Malformed files, duplicate keys, non-object roots, empty files, and symlinked destinations are rejected.
- A missing destination is created as `0600`. An unchanged file isn't rewritten. A changed file gets an owner-only `<file>.<random>.bak` backup and is replaced atomically, keeping its permissions. The write is refused if the file changed after it was read.

### Installer

- `scripts/install.ts` keeps the current order: everything is validated before anything changes.
  - Validated first: targets, the `AGENTS.md` marker, duplicate skills, scripts, and MCP servers, settings overlays and destinations, and MCP commands and conflicts.
  - Changed after: `AGENTS.md`, adapters, links, settings, and MCP servers.
- Output lines and error messages keep their current forms (`linked`, `generated`, `validated`, `updated`, `unchanged`, `backup`, and `error: …`), except messages that mention Python.
- The wrapper's checks are the only work done before Node takes over. It fails with `error:` and changes nothing if Node is missing or too old, or if npm is missing when dependencies are stale.
- Running `npm ci` changes only the repository's `node_modules`, not any agent's configuration.
- `--runner` does what `install-runner.sh` does today:
  - It points every agent home under `$RUNNER_TEMP/dotagents/`, ignoring any homes already set.
  - It installs the given targets, defaulting to `copilot`.
  - It appends each home to `$GITHUB_ENV`.
  - It requires `RUNNER_TEMP` and `GITHUB_ENV`.

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

- **Runners that use this action:** add `actions/setup-node` with Node 22.18 or later before the dotagents step, if the runner doesn't already have it. They no longer need `python3`.
- **New machines:** install Node 22.18+ before running `./install.sh`. Python is no longer needed.

## Phases

### Phase 1: One toolchain

- Add the root `package.json`, with scripts `typecheck` (`tsc`), `lint` (`oxlint`), `format` (`oxfmt`), `format:check` (`oxfmt --check`), and `test` (`node --test 'tests/**/*.test.ts'`). Also add `tsconfig.json` (with `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `noEmit`, and `strict`), `.oxlintrc.json`, `.oxfmtrc.json`, and one lockfile.
- Delete `scripts/mcp/package.json` and its lockfile, and ignore `/node_modules/` at the root.
- Convert `scripts/mcp/*.mjs` to `.ts` with types, and move their tests to `tests/mcp-*.test.ts`.
- Point `install.sh` at `node scripts/mcp/sync-mcp.ts` and the root `npm ci`, and update `tests/test_install.py`'s MCP fixture to match.
- Run `oxfmt` across everything the tools cover.

### Phase 2: Settings in TypeScript

- Move the shared code into `scripts/lib/` (`json.ts`, `files.ts`, and `edit.ts`), and move the MCP sync onto it.
- Implement `scripts/settings.ts` with the semantics above. Give it a temporary CLI (`[--check] <overlay> <destination>`) so the Bash installer can call it until phase 4.
- Port `tests/test_settings.py` to `tests/settings.test.ts`. Add cases showing that unrelated formatting, and comments in unrelated values, survive.
- Switch `install.sh` from `python3 merge-settings.py` to the Node CLI, and replace the Python check with a Node check. Delete `scripts/merge-settings.py` and `tests/test_settings.py`.
- Update `tests/test_install.py`: its allowlisted `PATH` gets `node` instead of `python3`, and its missing-Python tests become missing-Node tests.

### Phase 3: Installer tests in TypeScript

- Port `tests/test_install.py` to `tests/install.test.ts`, keeping every case, including the runner test, and the same fixture approach. That means a copied repository, temporary homes, an allowlisted `PATH`, and `node_modules` symlinked from the checkout.
- Delete `tests/test_install.py`, so no Python remains.
- The tests run `./install.sh` and `scripts/install-runner.sh` as separate processes, so they keep working unchanged through phase 4. Phase 4 then points the runner test at `--runner`.

### Phase 4: Installer in TypeScript

- Implement `scripts/install.ts`, ported from `install.sh`, including `--runner`. It calls `settings.ts` and the MCP sync directly.
- Replace `install.sh` with the wrapper. Point `action.yml` at `install.sh --runner`, and delete `scripts/install-runner.sh`. Remove the temporary settings CLI, and `sync-mcp.ts`'s CLI, if nothing else uses them.
- Add tests for the wrapper. A missing `node`, a fake `node` reporting an older version, and stale dependencies with no `npm` must each fail with `error:` and change nothing.
- Run the real install from a login shell. Every settings and MCP file should report `unchanged`.

## Obstacles

## Found bugs
