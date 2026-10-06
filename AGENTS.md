# Personal Agent Instructions

These instructions apply to all coding sessions.

## Attribution

Do not add agent attribution to commits or pull requests.

When creating commits or pull requests:

- Do not add `Co-authored-by` trailers for Cursor, Claude, Zed, or another agent.
- Do not add "Made with" footers, badges, or similar agent attribution to commit messages or pull request descriptions.
- Do not enable or suggest agent attribution settings.

If attribution is controlled by a tool or setting, leave it disabled.

## Posting on My Behalf

Never post, publish, or send anything on my behalf without asking first. This applies even when the action seems implied by the task.

Ask before:

- Creating, editing, or deleting comments, reviews, or reactions on issues, pull requests, or discussions.
- Opening, updating, merging, closing, or reopening pull requests or issues, including changing titles, descriptions, labels, or reviewers.
- Pushing commits or branches, or creating releases and tags on a remote.
- Sending messages, emails, or chat posts, or publishing to any external service.

Local work such as editing files and creating local commits does not need approval. Approval for one post doesn't extend to the next; ask again for each new action, and show the exact content you intend to post.

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

For a large effort, use the `phased-plan` skill. It covers discussing scope, writing and approving the plan, implementing it end to end, updating docs, and reporting back.

### Branch First

If a plan has multiple phases and therefore multiple commits, do the whole plan on one branch rather than directly on the default branch. Create that branch once, before writing the plan or starting phase one, if it doesn't already exist. The plan and every phase then commit to that same branch.

- One plan, one branch, one commit per phase. Don't create a branch per phase or stack phase branches on top of each other.
- Name the branch for the plan (e.g. `rainforest`), not for a phase (not `rainforest/phase-3-basins`).
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

## Browser Tests

If `http://127.0.0.1:9222/json/version` responds, drive that shared headless Chrome for browser tests, screenshots, and GPU timings instead of launching a browser. Follow the `browser-testing` skill: serve on `127.0.0.1` ports 41000–41999 and use a fresh browser context per run.
