---
name: ghostwrite
description: Have a subagent running a different model write prose for others to read — pull request descriptions, Slack messages, emails, issue comments, review replies — from a full brief of this session's context, then fact-check its draft. Use when a rule names a writing model for that kind of prose, or when the user asks for a different model to write something.
---

# Ghostwrite

Some models code better and others write better. This skill keeps the work in
the current session's model and hands only the writing to another one, as a
subagent. The writer hasn't seen this conversation, so the brief has to carry
everything it needs, and you stay responsible for what the text says.

## Check that the model can be chosen

Write the text yourself, and say so in one line, when either is true:

- The harness can't run a subagent on a chosen model. GitHub Copilot's task
  tool takes a per-call `model`; Claude Code's subagents only choose among
  Claude models.
- The text is short and mechanical, such as a commit message or a one-line
  reply.

## Write a brief, not a draft

Don't send the writer a draft to reword. A draft anchors it to your phrasing,
which defeats the point. Send facts and intent, in the second person:

1. **What to write and where it goes**: the kind of text, its destination, and
   who can read it, such as a public repository or a private channel.
2. **The reader and the point**: who reads it, what they should understand or
   do afterward, and how long it should be.
3. **Facts**: what changed or happened, with numbers and names exactly as they
   should appear. Mark what was measured and what was only inferred.
4. **Reasoning from this session**: decisions, the reasons for them, and the
   alternatives rejected. This is what the writer can't recover on its own.
5. **Links**: full URLs, each with a title.
6. **What to leave out**: private details, figures that audience shouldn't
   see, internal tracker IDs, and anything the user asked to omit.
7. **Format rules**: paste the sections of your standing instructions that
   govern this text, such as pull request description structure, draft
   formatting, or disclosure labels. Subagents may not load those
   instructions, so don't just name them.
8. **Sources to read**: commands or paths for material the writer can check
   itself, such as `git diff main...HEAD` or `gh pr view 123`, rather than
   pasting long diffs.
9. **The user's words**: anything the user said about tone or content, quoted.

Tell the writer to return only the finished text, and not to post, push, edit
files, or send anything.

## Review the draft

Check every claim against what you know. Fix factual errors, wrong or missing
links, leaked private details, and broken format, and leave the wording alone
otherwise. If the draft is badly off, send it back to the same writer with
notes rather than rewriting it yourself.

## Deliver it

Hand the text on as your standing instructions say for that kind of prose,
such as a fenced code block for a message draft. Don't mention the writer or
its model in the text. When the user asks for changes, send them to the same
writer so the voice stays consistent.
