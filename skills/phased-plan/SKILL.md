---
name: phased-plan
description: Plan and carry out a large, multi-phase effort end to end — discuss scope, commit a phased plan to the effort's branch, get approval, implement every phase, update docs, remove the plan, open a pull request, and report. Use when the user asks to plan a big change, or when work spans several features, subsystems, or commits.
---

# Phased Plan

A large effort moves through eight steps in order. Follow the branch, grove,
and Phase Workflow rules in the standing instructions throughout.

## 1. Discuss

Talk through the effort and its scope with the user before writing anything.
Read the relevant code, raise open questions, and settle them now rather than
during implementation. Move on once the user agrees on scope.

## 2. Write the plan

- Give the effort a short kebab-case name, such as `stock-perf`. The name is
  also the branch name and the commit message prefix.
- If you're on the default branch (`main` or `master`), create a branch with
  the effort's name. In grove-managed projects, use
  `grove path BRANCH --from BASE` (usually `--from main`) and work in that
  worktree. Always pass `--from`, or grove prompts for a base branch.
- If you're already on another branch, the effort most likely belongs there.
  Stay on it and use the branch name as the effort's name. Ask only if the
  branch's existing work looks unrelated.
- Write the plan to `PLAN-<name>.md` at the repository root, using the
  template below.
- If the user must do anything by hand, such as generating keys, installing
  software, approving access, or deploying, list each step under **User
  steps**. Give the phase it happens in and the exact commands.
- Commit the plan to the branch.

## 3. Confirm

Show the user the plan and ask for final approval. Don't start implementing
until they approve. If they ask for changes, update the plan, commit, and ask
again.

## 4. Implement

Once approved, carry out every phase to completion without stopping for
check-ins between phases. For each phase: implement only its scope, run the
project's lint, tests, and type checks, fix failures, and commit.

Prefix every commit message in the effort with its name instead of a phase
number, such as `stock-perf: Add unit tests for quote cache` rather than
`Phase 1: Add unit tests`. This includes the plan, docs, and plan-removal
commits.

Reread `PLAN-<name>.md` at the start of each phase. It's the source of truth
if earlier conversation context has been summarized away.

### Handling obstacles

Keep going through small problems. Work around minor issues, small obstacles,
and needed tweaks to the plan. Record each obstacle and its workaround under
the plan's **Obstacles** section as you go, so none are lost before the report.

Stop and check back with the user only when:

- A fundamental assumption of the plan turns out to be wrong.
- A new finding meaningfully reshapes the effort as a whole.

When stopping, explain the finding, what has been committed so far, and how
you propose to proceed.

## 5. Update docs

After the last phase, review the repository for documentation the changes made
stale or incomplete, such as READMEs, agent instructions, guides, and examples.
Update it, validate, and commit.

## 6. Remove the plan

Copy the plan's **Obstacles** notes into your working context for the report,
then delete `PLAN-<name>.md` in its own commit.

## 7. Open a pull request

Once the effort is done and ready for review, open a pull request for the
branch against the base branch.

- If the repository is private and only the user's (owned by their account,
  no one else working in it), push the branch and open the pull request
  without asking first, as the standing instructions allow there.
- If it's public, or owned by or shared with anyone else, such as an
  organization or another user, show the user the exact title and
  description and ask before pushing and opening it.
- If that's unclear, treat the repository as public or shared.
- Where the host supports drafts (e.g. GitHub), open it as a draft.
- On Gitea, open a regular pull request. Don't add a WIP prefix.

## 8. Report

Report back with:

- What was done, phase by phase.
- The branch, its commits, and the pull request link.
- Final validation status, with output for anything that fails.
- How the user can try the changes: the exact command, URL, example, preset, or
  screen to open, and what to look for there. Name the best few starting
  points when there are many.
- Every obstacle and the workaround used.
- Any follow-ups left out of scope.

## Plan template

The plan carries its own execution rules so they survive a long run.

```markdown
# Plan: <name>

## Goal

<What this effort achieves and why.>

## Scope

<What's in, and what's explicitly out.>

## Execution rules

- All work happens on the `<name>` branch. One plan, one branch, one commit per phase.
- Prefix every commit message with `<name>: `.
- For each phase: implement only its scope, run validation, fix failures, commit.
- Work around small obstacles and log them under Obstacles. Stop only if a
  fundamental assumption is wrong or a finding reshapes the effort.
- After the last phase: update docs and commit, delete this file and commit,
  open a pull request (draft where supported; ask first unless the repository
  is private and the user's alone), then report results with every obstacle and workaround,
  and how the user can try the changes.

## Validation

<The project's lint, test, and type-check commands.>

## User steps

<Anything the user must do by hand, such as keys, installs, approvals, or
deploys: the phase each happens in, and the exact commands. Omit if none.>

## Phases

### Phase 1: <title>

<Changes, files touched, and what "done" looks like.>

### Phase 2: <title>

...

## Obstacles

<Filled in during implementation: obstacle, then workaround.>
```
