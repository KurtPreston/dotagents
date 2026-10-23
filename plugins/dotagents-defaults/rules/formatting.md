## Formatting

These apply to how you write references in chat responses and anything else I read.

### File Links

When mentioning a file in a chat response, write it as a Markdown link so I can click it to open the file, rather than as plain text or inline code.

- Show the path relative to the repository root as the link text, and use the absolute path as the target, such as [`src/auth/login.ts`](/Users/me/project/src/auth/login.ts). Editors like Zed resolve absolute paths reliably, while relative targets may not open.
- To point at a line or range, add `#L42` or `#L42-L50` to the target.
- If the path contains spaces, wrap the target in angle brackets, such as `[notes](</Users/me/My Notes/todo.md>)`.

This applies only to chat responses. Files, commits, and pull requests are read elsewhere, where absolute paths on my machine don't resolve and are private details; use repository-relative paths there.

### Issue and Pull Request Links

Whenever you reference an issue, pull request, or ticket, make it a clickable link to it rather than a bare number like `#123` or `ABC-42`.

- In chat responses, Slack drafts, task notes, and other places that don't link references on their own, write a Markdown link to the full URL, such as [acme/app#123](https://github.com/acme/app/pull/123) or [ABC-42](https://linear.app/acme/issue/ABC-42).
- On GitHub, in pull request descriptions, comments, and commit messages, `#123` and `owner/repo#123` already link themselves, so the short form is fine there.
- If you don't know the URL, look it up, such as with `gh pr view --json url`, rather than leaving the reference bare.
