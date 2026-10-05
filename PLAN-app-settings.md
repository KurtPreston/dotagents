# Proposal: install selected app settings

## Goal

Keep selected app settings in this repository and apply them during installation without symlinking or replacing the application's entire configuration file.

Start with Claude Code's attribution settings. Keep unrelated local settings under the user's control.

## Current behavior

`install.sh` installs instructions and skills for `cursor`, `zed`, and `claude`, defaulting to all three. It respects `CURSOR_HOME`, `ZED_HOME`, `CLAUDE_HOME`, and `AGENTS_HOME`. It currently does not edit application settings.

Settings should use a separate installation mechanism: links are appropriate for files fully owned by this repository, but not for shared configuration files.

## Proposed layout

```text
settings/
  claude.json
scripts/
  merge-settings.py
tests/
  test_settings.py
```

`settings/claude.json` contains only values this repository should enforce:

```json
{
  "attribution": {
    "commit": "",
    "pr": "",
    "sessionUrl": false
  }
}
```

The installer maps this file explicitly to `$CLAUDE_HOME/settings.json` (normally `~/.claude/settings.json`). Do not put destination paths in the overlay or infer them from arbitrary filenames.

The repository copy is the source of truth for declared settings. Changes take effect on the next install, not immediately as they would through a symlink.

## Merge contract

Use a recursive JSON object overlay, with the repository winning for declared values:

- Preserve keys absent from the overlay, including nested keys.
- Recursively merge when both values are objects.
- Replace scalar values and arrays with the overlay value; do not concatenate arrays.
- Treat `null` as a literal JSON value, not a deletion instruction. This is deliberately not JSON Merge Patch (RFC 7396).
- If an overlay object would replace an existing non-object, fail with the conflicting key path rather than silently discard that value. The user can resolve that type mismatch explicitly.
- Require both documents to have object roots. Reject malformed JSON, duplicate keys, and nonstandard numeric constants rather than normalizing ambiguous input.
- Treat a missing destination as `{}`. An existing empty file is invalid, not a missing file.
- Removing a key from the overlay stops enforcing it but does not delete it from the destination. Automatic pruning and uninstall restoration are out of scope.

The explicit object form disables attribution text and session links without requiring the newer `"attribution": false` shorthand (Claude Code v2.1.281+). See the [official attribution reference](https://code.claude.com/docs/en/settings-reference#attribution).

For example, installing the attribution overlay updates `attribution.commit`, `attribution.pr`, and `attribution.sessionUrl` while retaining any other attribution fields, permissions, plugins, and application preferences. A later local edit to either declared value is overwritten on the next install.

This is a JSON data merge, not an app schema validator. App-specific values must still be supported by the installed application version.

## Safe writes and dependencies

Use a small Python 3 helper with the standard library (`json`, `pathlib`, `tempfile`, and related modules). This introduces an explicit Python 3 dependency but requires no pip packages. Do not assume Python 3 is installed on every macOS machine; check availability and produce an actionable error before installation mutations when Claude is selected. Cursor-only and Zed-only installs should not require Python.

The helper should:

1. Validate the overlay and destination and compute the complete result before changing the destination.
2. Refuse symlink destinations, including dangling symlinks, with a clear error; do not silently replace links or modify their referents.
3. Compare parsed values first. If nothing changes, report `unchanged` and leave bytes, timestamps, and backups untouched.
4. Before changing an existing file, create a unique, non-overwriting backup beside it containing its original bytes. Abort if backup creation fails. Backups may contain sensitive local configuration, so restrict their permissions to the owner.
5. Write formatted JSON with a trailing newline to a temporary file in the destination directory, preserve existing permission bits (use `0600` for new files), and atomically replace the destination. Clean up temporary files on failure.
6. Recheck that the destination has not changed since it was read before replacing it, and abort if a change is detected. This reduces accidental lost updates but is not a lock against concurrent application writes; recommend installing while the app is not writing settings.
7. Report the destination and backup paths without logging configuration values.

A changed file may be reformatted; unrelated JSON values are preserved, not necessarily their textual formatting. Backups restore the original bytes. Backup retention is manual in this initial version.

## Installer integration

Keep the existing commands:

```sh
./install.sh
./install.sh claude
./install.sh cursor zed
```

- Selecting Claude applies `settings/claude.json` in addition to its current instruction and skill setup.
- Selecting only Cursor or Zed does not read or write Claude settings.
- Validate all target names, required dependencies, and selected settings inputs before beginning installation mutations. Unknown targets and invalid settings should fail early.
- Retain existing protections for user-managed instruction files and skills.
- Return a nonzero exit status on settings failure. There is no transaction across settings, instructions, and skills: runtime failures can leave earlier operations applied, and rerunning after resolving the failure is the recovery path.

No new command-line flags, manifest format, or settings registry are needed initially.

## Scope boundaries

The first implementation supports Claude's strict JSON settings only. Do not create empty Cursor or Zed overlays or assume their destinations match their instruction directories.

Future integrations should explicitly identify the real settings path and use a format-aware editor where needed. In particular, JSON-with-comments configuration needs a separate approach that preserves comments; do not strip comments or run it through the strict JSON helper.

Do not store secrets in repository overlays. Local secrets remain local, including in backups; tests must never use real home-directory configuration.

## Implementation plan

One plan, one branch, one commit per phase. Don't create a branch per phase or stack phase branches on top of each other.

Use a single branch named `app-settings`, created before phase one. If the repository is grove-managed at implementation time, obtain that branch's worktree with `grove path app-settings` and do all work there; do not switch an existing worktree's branch.

### Phase 1 — Implement and test the JSON overlay helper

- Add `scripts/merge-settings.py` with the merge contract, input validation, no-op detection, backups, safe writes, and clear errors described above.
- Add standard-library `unittest` coverage in `tests/test_settings.py` using temporary directories only.
- Cover nested preservation, replacements, arrays, literal null, object/non-object conflicts, missing files, malformed and ambiguous input, non-object roots, symlinks, permission bits, exact backup contents, repeated installs, and unchanged-file behavior.
- Exercise backup/write failures and destination-change detection through controlled tests; verify failed operations leave the original destination intact and clean up temporary files.

Validation: `python3 -m unittest discover -s tests -v` and `bash -n install.sh`. Fix failures, then commit the helper and tests.

### Phase 2 — Integrate Claude settings and document ownership

- Add `settings/claude.json` with the attribution values above.
- Add installer preflight and invoke the helper for Claude, respecting `CLAUDE_HOME`.
- Extend tests to invoke `install.sh` with `HOME` and all four configuration-directory overrides pointing into temporary directories.
- Cover default installation, Claude-only installation, Cursor/Zed-only isolation, reruns, invalid targets, missing Python, invalid settings, and existing instruction-file protection. Confirm preflight failures do not create links or generated adapters.
- Update `README.md` with the new layout, dependency, merge/ownership rules, reinstallation behavior, backup recovery, and strict-JSON scope.

Validation: `python3 -m unittest discover -s tests -v` and `bash -n install.sh`. Integration tests must exercise the existing instruction and skill installs as well as settings. Fix failures, then commit integration and documentation.

## Acceptance criteria

- Installing Claude sets `attribution.commit` and `attribution.pr` to empty strings and `attribution.sessionUrl` to `false`.
- Unrelated local settings survive, including nested settings.
- A second install makes no settings-file change and creates no backup.
- Changed existing settings receive a byte-for-byte backup before replacement.
- Invalid input or a settings-write failure does not corrupt the destination.
- Existing target selection and home-directory overrides continue to work.
- No real application configuration is touched by tests.
