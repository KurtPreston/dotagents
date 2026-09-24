# dotagents

Personal instructions and skills shared across Cursor, Zed, and Claude Code.

## Layout

- `AGENTS.md` — canonical, always-on instructions for every agent.
- `skills/<name>/SKILL.md` — reusable Agent Skills shared between agents.
- `install.sh` — installs compatibility links and adapters in each agent's global configuration.

Agent-specific files are installation details, not sources of truth. Edit `AGENTS.md` or a skill in this repository, then commit the change normally.

## Install

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

Run the installer again after adding a skill or changing `AGENTS.md` if you use Cursor. Zed and Claude Code see edits to the symlinked instructions immediately.
