# Personal Agent Instructions

These instructions apply to all coding sessions.

## Attribution

Do not add agent attribution to commits or pull requests.

When creating commits or pull requests:

- Do not add `Co-authored-by` trailers for Cursor, Claude, Zed, or another agent.
- Do not add "Made with" footers, badges, or similar agent attribution to commit messages or pull request descriptions.
- Do not enable or suggest agent attribution settings.

If attribution is controlled by a tool or setting, leave it disabled.

## Section Comments

When writing or editing code, add brief comments every 3–10 lines. Each comment should be succinct guiding text that describes what the lines below it are doing.

- Place a comment immediately before a logical block of 3–10 lines.
- Keep comments to one short phrase or sentence.
- Describe the upcoming block's purpose, not line-by-line narration.
- Skip comments when a block is shorter than three lines and already self-explanatory.

Prefer:

```typescript
// Validate input and normalize defaults
const email = input.email?.trim().toLowerCase()
if (!email || !isValidEmail(email)) {
  throw new ValidationError('Invalid email')
}
const role = input.role ?? 'member'

// Persist user and emit creation event
const user = await db.users.create({ email, role })
await events.publish('user.created', { userId: user.id })
```

Avoid line-by-line narration:

```typescript
// Trim email
const email = input.email?.trim().toLowerCase()
// Check if valid
if (!email || !isValidEmail(email)) {
```

## Phased Plans

When a task is large enough to span multiple logical steps, break it into phases before implementing.

Use multiple phases when the work involves:

- Several distinct features or refactors.
- Changes across multiple subsystems or directories.
- Risky changes that are easier to verify incrementally.
- More than one commit worth of work.

Single-step fixes and small changes do not need phasing.

### Branch First

If a plan has multiple phases and therefore multiple commits, do the whole plan on one branch rather than directly on the default branch. Create that branch once, before phase one, if it doesn't already exist. Every phase then commits to that same branch.

- One plan, one branch, one commit per phase. Don't create a branch per phase or stack phase branches on top of each other.
- Name the branch for the plan (e.g. `rainforest`), not for a phase (not `rainforest/phase-3-basins`).
- When writing a plan document for another agent to implement, state this rule as-is. Don't restate it as "each phase goes on its own branch."

### Grove-Managed Projects

A project is grove-managed if its root has a `grove.json` or `grove.jsonc` next to a bare `.base` repo, with one worktree folder per branch (e.g. `main/`). In these projects, each branch has its own worktree, and the folder name matches the branch name.

- Don't run `git checkout`, `git switch`, or `git checkout -b` inside an existing worktree, especially the default branch's. Leave each worktree on its own branch.
- Create or find a branch's worktree with `grove path BRANCH`, which prints the path. Then do all of that branch's work and commits there. For a plan, that means one `rainforest` branch in a `rainforest/` worktree.
- Use flat branch names without slashes so the branch and folder names stay identical.

### Phase Workflow

For each phase:

1. **Implement** — Complete only that phase's scope.
2. **Validate** — Run the project's lint, tests, and type checks when available, using existing project scripts.
3. **Fix** — Resolve validation failures before proceeding.
4. **Commit** — Create a focused commit with a clear message describing what the phase accomplished.

Each phase should leave the branch in a passing state, so its commit can be reviewed on its own. When presenting a multi-phase plan, number the phases and identify the validation that will run between them.
