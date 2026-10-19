## Phased Plans

When a task is large enough to span multiple logical steps, break it into phases before implementing.

Use multiple phases when the work involves:

- Several distinct features or refactors.
- Changes across multiple subsystems or directories.
- Risky changes that are easier to verify incrementally.
- More than one commit worth of work.

Single-step fixes and small changes do not need phasing.

For a large effort, use the `phased-plan` skill. It covers discussing scope, writing and approving the plan, implementing it end to end, updating docs, opening a pull request, and reporting back.

When the user wants to continue work in a new session, such as executing a plan with a fresh context, use the `handoff` skill to write a prompt they can paste.

### Branch First

If a plan has multiple phases and therefore multiple commits, do the whole plan on one branch rather than directly on the default branch. If you're on the default branch, create that branch once, before writing the plan or starting phase one. If you're already on another branch, the plan most likely belongs there, so use it. The plan and every phase then commit to that same branch.

- One plan, one branch, one commit per phase. Don't create a branch per phase or stack phase branches on top of each other.
- Name the branch for the plan (e.g. `rainforest`), not for a phase (not `rainforest/phase-3-basins`).
- Prefix each commit message with the branch name rather than a phase number, e.g. `rainforest: Add basin erosion` instead of `Phase 3: Add basin erosion`.
- When writing a plan document for another agent to implement, state this rule as-is. Don't restate it as "each phase goes on its own branch."

### Grove-Managed Projects

A project is grove-managed if its root has a `grove.json` or `grove.jsonc` next to a bare `.base` repo, with one worktree folder per branch (e.g. `main/`). In these projects, each branch has its own worktree, and the folder name matches the branch name.

- Don't run `git checkout`, `git switch`, or `git checkout -b` inside an existing worktree, especially the default branch's. Leave each worktree on its own branch.
- Create or find a branch's worktree with `grove path BRANCH --from BASE`, which prints the path. Then do all of that branch's work and commits there. For a plan, that means one `rainforest` branch in a `rainforest/` worktree.
- Always pass `--from BASE` (usually the default branch, e.g. `--from main`). Without it, creating a new branch prompts for a base branch and can hang an agent's shell even without a TTY.
- Use flat branch names without slashes so the branch and folder names stay identical.

### Phase Workflow

For each phase:

1. **Implement** — Complete only that phase's scope.
2. **Validate** — Run the project's lint, tests, and type checks when available, using existing project scripts.
3. **Fix** — Resolve validation failures before proceeding.
4. **Commit** — Create a focused commit with a clear message describing what the phase accomplished.

Each phase should leave the branch in a passing state, so its commit can be reviewed on its own. When presenting a multi-phase plan, number the phases and identify the validation that will run between them.
