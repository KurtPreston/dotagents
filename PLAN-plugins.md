# Plan: plugins

## Goal

Replace the git-ignored `rules-local/` and `skills-local/` folders with
pluggable "dotagents plugins". A plugin is a folder under `plugins/<name>/`
holding any of `rules/*.md`, `skills/<name>/` and `scripts/`. Each plugin can
be its own git repo, so private content gets version control with
`git init plugins/local`, and a team can share one with
`git clone <repo> plugins/<team>`. The repository's own `rules/` and `skills/`
act as the built-in core plugin.

## Scope

In:

- `install.sh` discovers `plugins/*/` in name order. Rules join core first,
  then each plugin's. Skills from core and every plugin are linked, and a
  duplicate skill name across any two sources is an error.
- Each plugin's `scripts/*` executables are linked into `$AGENTS_HOME/bin/`
  (normally `~/.agents/bin/`), and a duplicate script name is an error.
  Rules and skills call scripts at `~/.agents/bin/<script>`, a single path
  that works for every plugin and teammate, including inside symlinked
  skills. This replaces the `{{PLUGIN_ROOT}}` placeholder idea, which
  couldn't reach skills since they're symlinked rather than generated.
- The core's own `scripts/` holds installer helpers such as
  `merge-settings.py`, so it isn't linked into `bin/`.
- Git ignores `/plugins/`. No placeholder folders.
- Remove `rules-local/` and `skills-local/` support outright, with no fallback.
- Port the current local rules, skills and scripts into a new
  `plugins/local` git repo.

Out:

- Settings overlays in plugins (settings stay core-only).
- Plugins located outside the repository, and remote plugin management.
- Pruning installed links left behind by removed skills or scripts.

## Execution rules

- All work happens on the `plugins` branch. One plan, one branch, one commit per phase.
- Prefix every commit message with `plugins: `.
- For each phase: implement only its scope, run validation, fix failures, commit.
- Work around small obstacles and log them under Obstacles. Stop only if a
  fundamental assumption is wrong or a finding reshapes the effort.
- Log existing bugs found along the way under Found bugs. Fold in fixes that
  belong to this effort, save small unrelated fixes for their own branches,
  and leave nuanced ones unfixed for discussion.
- After the last phase: update docs and commit, delete this file and commit,
  open a pull request (draft where supported; ask first only if the
  repository is public), fix each small unrelated bug on its own
  branch from the base branch with its own pull request, then report results
  with every obstacle and workaround, every bug found and how it was handled,
  and how the user can try the changes.

## Validation

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
bash -n install.sh
```

## Phases

### Phase 1: Load rules and skills from plugins

- `install.sh`: collect `plugins/*/` in name order; generate `AGENTS.md`
  from `rules/*.md` and then each plugin's `rules/*.md`; link skills from
  `skills/` and each plugin's `skills/`; fail before any changes on a
  duplicate skill name, naming both sources.
- Drop every `rules-local/` and `skills-local/` code path, and update the
  `AGENTS.md` marker and error text to mention plugins.
- `.gitignore`: replace the `rules-local`/`skills-local` entries with `/plugins/`.
- Update `tests/test_install.py`: plugin rules ordering across two plugins,
  plugin skills linking, and duplicate-skill conflicts (core vs plugin and
  plugin vs plugin).
- Done when validation passes.

### Phase 2: Link plugin scripts into ~/.agents/bin

- `install.sh`: link each plugin's `scripts/*` into `$AGENTS_HOME/bin/` for
  every install target, using the existing `link_file` safety checks; fail
  before any changes on a duplicate script name.
- Tests for script linking and script conflicts.
- Done when validation passes.

### Phase 3: Port local content into plugins/local

- `git init plugins/local`, then move `rules-local/*.md` to
  `plugins/local/rules/`, `gh-as` and `slack-me` to `plugins/local/scripts/`,
  and `skills-local/pr-request-review` to `plugins/local/skills/`.
- Rewrite script paths in those files to `~/.agents/bin/<script>`.
- Commit inside `plugins/local`, remove the old folders, run `./install.sh`,
  and check that `AGENTS.md` contains the local rules, the skill link points
  into `plugins/local`, and `~/.agents/bin/gh-as` works.
- This phase changes only ignored files, so it has no commit on the branch.

## Obstacles

## Found bugs
