# dotagents

Personal instructions, skills, and selected app settings for Cursor, Zed, and Claude Code.

## Layout

- `AGENTS.md` — canonical, always-on instructions for every agent.
- `skills/<name>/SKILL.md` — reusable Agent Skills shared between agents.
- `settings/claude.json` — selected Claude Code settings enforced on install.
- `scripts/merge-settings.py` — strict JSON overlay helper with safe writes and backups.
- `tests/` — helper and installer tests using temporary configuration directories.
- `install.sh` — installs compatibility links, adapters, and selected settings in each agent's global configuration.

Edit `AGENTS.md`, a skill, or a settings overlay in this repository, then commit the change normally. Installed links and adapters are installation details; app settings files also retain locally managed values.

## Install

The installer requires Bash and standard Unix utilities. Installing Claude (including the default all-agent install) additionally requires `python3` on `PATH`, with no pip packages. Cursor-only and Zed-only installs do not require Python.

Install support for all three agents:

```sh
./install.sh
```

Install only selected agents:

```sh
./install.sh cursor zed
./install.sh claude
```

The installer configures:

| Agent | Standing instructions | Skills |
| --- | --- | --- |
| Cursor | Generated at `~/.cursor/rules/dotagents.mdc` | Linked individually into `~/.agents/skills/` |
| Zed | `~/.config/zed/AGENTS.md` symlink | Linked individually into `~/.agents/skills/` |
| Claude Code | `~/.claude/CLAUDE.md` symlink | Linked individually into `~/.claude/skills/` |

Cursor requires `.mdc` frontmatter, so its adapter is regenerated from `AGENTS.md` whenever the installer runs. Zed and Claude Code can use the canonical file directly through symlinks.

Existing user-managed instruction files are never overwritten. Skills are linked one directory at a time so unrelated skills can coexist in each destination.

## Configuration

Override an agent's configuration directory with `CURSOR_HOME`, `ZED_HOME`, `CLAUDE_HOME`, or `AGENTS_HOME`:

```sh
ZED_HOME="$HOME/custom-zed" ./install.sh zed
```

Run the installer again after adding a skill, editing a settings overlay, or changing `AGENTS.md` if you use Cursor. Zed and Claude Code see edits to the symlinked instructions immediately.

## App settings

When Claude is selected, the installer merges `settings/claude.json` into `$CLAUDE_HOME/settings.json` (normally `~/.claude/settings.json`). It does **not** symlink that file. The initial overlay disables commit and PR attribution text and session links:

```json
{
  "attribution": {
    "commit": "",
    "pr": "",
    "sessionUrl": false
  }
}
```

The explicit object form avoids the newer `"attribution": false` shorthand, which requires Claude Code v2.1.281+. See the [Claude Code attribution reference](https://code.claude.com/docs/en/settings-reference#attribution). These are user settings; higher-precedence project or managed settings can override them, and local user settings do not automatically reach cloud sessions.

### Ownership and merging

- Repository values win for declared settings each time you install; unrelated keys, including nested keys, survive.
- Objects merge recursively. Scalars and arrays replace the previous value; arrays do not concatenate. `null` is a literal value, not a deletion instruction.
- An overlay object conflicting with a local non-object fails with its key path. Resolve the mismatch explicitly before rerunning.
- Removing a key from the overlay stops enforcing it but does not remove the installed value. There is no automatic pruning or uninstall restoration.
- A missing destination is created. Existing empty files, malformed JSON, duplicate keys, nonstandard numeric constants, non-object roots, and symlink destinations (including dangling links) are rejected.
- The helper validates JSON structure, not the application's settings schema. Keep app-specific values compatible with the versions you use. Do not commit secrets in overlays.

Only Claude's strict JSON settings are supported initially. Cursor and Zed settings are untouched; JSON-with-comments files need a separate, comment-preserving editor.

### Backups and recovery

A changed existing file gets a unique sibling backup named `settings.json.<random>.bak`, containing its exact original bytes with owner-only permissions (`0600`). The installer prints the backup path, never configuration values. Backups can contain local secrets: keep them private and remove old ones manually when no longer needed.

The updated JSON is written to a temporary file beside the destination and atomically replaces it, preserving existing permission bits; new settings files use `0600`. Formatting may change, but unrelated JSON values remain. A no-op leaves the file's bytes and modification time unchanged and creates no backup.

To undo an update, stop application writes and copy the printed backup over the settings file. This restores the whole pre-install snapshot, including any settings you may have changed afterward. Adjust or remove the repository overlay values before reinstalling, or installation will enforce them again.

Install while the app is not writing settings. The helper detects changes between reading and replacing a file, but this is not a lock against concurrent writes. Invalid targets, missing dependencies, and invalid selected settings fail before installation mutations. Later runtime failures return a nonzero status but do not roll back earlier instruction, skill, or settings operations; resolve the failure and rerun.

## Tests

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
bash -n install.sh
```

Tests use temporary homes and configuration-directory overrides, never real application settings.
