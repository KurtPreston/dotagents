---
name: phased-plan
description: Plan and carry out a large, multi-phase effort end to end — discuss scope, commit a phased plan to its own branch, get approval, implement every phase, update docs, remove the plan, and report. Use when the user asks to plan a big change, or when work spans several features, subsystems, or commits.
---

# Phased Plan

A large effort moves through seven steps in order. Follow the branch, grove,
and Phase Workflow rules in the standing instructions throughout.

## 1. Discuss

Talk through the effort and its scope with the user before writing anything.
Read the relevant code, raise open questions, and settle them now rather than
during implementation. Move on once the user agrees on scope.

## 2. Write the plan

- Create the plan's branch, named for the plan. In grove-managed projects,
  use `grove path BRANCH --from BASE` (usually `--from main`) and work in
  that worktree. Always pass `--from`, or grove prompts for a base branch.
- Write the plan to `PLAN-<name>.md` at the repository root, using the
  template below.
- Commit the plan to the branch.

## 3. Confirm

Show the user the plan and ask for final approval. Don't start implementing
until they approve. If they ask for changes, update the plan, commit, and ask
again.

## 4. Implement

Once approved, carry out every phase to completion without stopping for
check-ins between phases. For each phase: implement only its scope, run the
project's lint, tests, and type checks, fix failures, and commit.

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

## 7. Report

Don't push or open a pull request unless the user asks. Report back with:

- What was done, phase by phase.
- The branch and its commits.
- Final validation status, with output for anything that fails.
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
- For each phase: implement only its scope, run validation, fix failures, commit.
- Work around small obstacles and log them under Obstacles. Stop only if a
  fundamental assumption is wrong or a finding reshapes the effort.
- After the last phase: update docs and commit, delete this file and commit,
  then report results with every obstacle and workaround.

## Validation

<The project's lint, test, and type-check commands.>

## Phases

### Phase 1: <title>

<Changes, files touched, and what "done" looks like.>

### Phase 2: <title>

...

## Obstacles

<Filled in during implementation: obstacle, then workaround.>
```
