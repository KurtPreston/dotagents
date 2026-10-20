---
name: handoff
description: Write a self-contained prompt that lets a fresh agent session resume or execute work from this one. Use when the user asks for a prompt to resume, to start a new session, or to hand a plan to another agent or model.
---

# Handoff

The user often ends a session to continue in a new one, for example to
implement a plan with a clean context or to leave a sandbox. Give them a
prompt they can paste as-is. The next agent has not seen this conversation,
and it may be a weaker model.

## Before writing

- Commit or clearly note anything the next session depends on. If the work is
  uncommitted, say exactly what is in the working tree.
- Update any plan or docs the prompt points to, so the prompt can stay short
  and refer to them rather than repeat them.
- Stop processes you started unless the next session needs them, and say which
  are still running if any are.

## What the prompt covers

Write it in the second person, addressed to the next agent:

1. **Where to work**: repository, branch, and worktree path. Say not to create
   or switch branches when the work belongs on an existing one.
2. **What to read first**: AGENTS.md, the plan document, and any other files
   needed for context, in order.
3. **State**: what is done and committed, what is uncommitted, and what was
   changed but never seen working.
4. **Context from the user**: goals, constraints, and preferences stated in
   this session that aren't written down anywhere else.
5. **Findings so far**: what was learned, marking what was measured and what
   was only inferred from reading code.
6. **The task**: what to do next, concretely, with file and function names.
7. **How to work**: validation commands to run before each commit, commit
   granularity, whether to push or open pull requests, and when to stop and
   check in instead of continuing.
8. **Known problems**: environment issues hit in this session, such as tools
   that failed in a sandbox, so the next agent doesn't rediscover them.
9. **The report**: what to report when done, such as per-phase results, numbers,
   obstacles, and how the user can try the changes.

Leave out sections that don't apply. Prefer pointers to committed documents
over long inline explanations. Anything only in this conversation must go in
the prompt, or it's lost.

## Delivering it

Show the prompt in a single fenced code block so it's easy to copy. Before the
block, add one line naming the branch or worktree to open the new session in.
