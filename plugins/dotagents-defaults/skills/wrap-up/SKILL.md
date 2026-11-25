---
name: wrap-up
description: Before the user closes a session, inventory everything it touched — requests, promises, proposals, drafts, changes, and running work — check each against its live state, and list anything still open, most important first, so the user can decide its fate. Use when the user runs /wrap-up, or asks whether anything is left, whether there are lingering threads, or whether it's safe to close the session.
---

# Wrap Up

Closing a session loses its context. Anything still open only in the
conversation, such as an offer the user never answered or a draft they meant
to send, is easy to drop. Before they close it, find those threads and hand
them back as a short list they can answer in one reply.

## 1. Take inventory

Walk the whole session, including summaries of compacted history, and list
every thread it opened:

- **Requests:** everything the user asked for, including asides and
  "also…" items mid-message.
- **Promises:** anything you said you'd do, check, or come back to.
- **Proposals and questions:** offers, plans, and questions the user never
  answered, approved, or declined.
- **Drafts:** messages, comments, or posts written for the user to send.
- **Changes:** files edited, commits, branches, pull requests, tickets, tasks,
  and anything else written outside the conversation.
- **Running work:** background shells, servers, watchers, subagents,
  workflows, and browser tabs or contexts you opened.
- **Leftovers:** temporary files and scratch scripts.
- **Deadlines:** anything due today or tied to a meeting or a person waiting.

## 2. Check each against live state

Don't trust the conversation's word for it; things change after you report
them. Check what can be checked, read-only:

- `git status` and unpushed commits in every repository the session touched.
- Pull requests, tickets, and tasks: their current state, not the state you
  last reported.
- Running processes and agents you started, and temporary files you created.
- Whether the user replied to or acted on each proposal later in the session.

Some things can't be checked, such as whether the user sent a draft. List
those as questions rather than assuming either way.

## 3. Report

If nothing is open, say so in one line, with what you verified, such as
"Clear to close: changes committed, no processes running, all drafts
accounted for."

Otherwise, give one numbered list, most important first:

1. Work that would be lost: uncommitted or unpushed changes, running
   processes holding state, results only in the conversation.
2. People waiting: drafts not yet sent, asks unanswered, reviews promised.
3. Commitments due today.
4. Open proposals and unanswered questions.
5. Cleanup: processes to stop, temporary files, stale tabs.

One line per item: what it is, with a link, and a suggested fate, such as
"defer to tomorrow" or "drop". Say what each item is in plain words, such as
a task's title or a report's headline, rather than a bare ID the user has to
look up. Skip items that are done and verified; don't list them as
reassurance.

## 4. Apply the user's decisions

The user answers each item by number, such as "2: handling it in another
session" or "3: defer to tomorrow". Then:

- **Defer:** record it where the user tracks work, if a rule names a tracker,
  with a due date and the links needed to pick it up cold. Otherwise give a
  one-line note they can paste wherever they keep it.
- **Handled elsewhere:** note it on the item's task or ticket if there is
  one, so the other session can find it. Do nothing else.
- **Drop:** stop processes and delete temporary files you created. Close or
  delete anything else only with the user's approval, following their
  posting and deletion rules.
- **Do it now:** do it, unless it needs approval under the user's rules, in
  which case ask first.

Don't send, post, or comment anything on the user's behalf. Finish with one
line confirming the session is clear to close, or naming what remains.
