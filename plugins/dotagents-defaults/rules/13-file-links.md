## File Links

When mentioning a file in a chat response, write it as a Markdown link so I can click it to open the file, rather than as plain text or inline code.

- Show the path relative to the repository root as the link text, and use the absolute path as the target, such as [`src/auth/login.ts`](/Users/me/project/src/auth/login.ts). Editors like Zed resolve absolute paths reliably, while relative targets may not open.
- To point at a line or range, add `#L42` or `#L42-L50` to the target.
- If the path contains spaces, wrap the target in angle brackets, such as `[notes](</Users/me/My Notes/todo.md>)`.

This applies only to chat responses. Files, commits, and pull requests are read elsewhere, where absolute paths on my machine don't resolve and are private details; use repository-relative paths there.
