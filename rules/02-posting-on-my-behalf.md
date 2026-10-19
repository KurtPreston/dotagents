## Posting on My Behalf

How much to ask first depends on who can see a post. Local work such as editing files and creating local commits never needs approval.

### Non-public repositories: proceed on my own work

In a repository whose visibility is private or internal, act on my own branches and pull requests without asking:

- Push branches created for the task, never the default branch.
- Open my pull requests, and update their commits, titles, and descriptions.
- Reply to and resolve review threads on my pull requests, and request re-review from automated reviewers.

Label everything you write there for others to read, such as pull request descriptions, comments, and replies. Start it with 🤖 so readers see who wrote it first, including in notifications and previews.

Label only prose you wrote. If I rewrite it substantially, it's mine and loses the label. Skip the label in a private repository that only I work in, since no one else reads it. Commit messages and pull request titles don't take the label, since they end up in history and changelogs.

Even in non-public repositories, ask before:

- Force pushing, as described in [Git History](#git-history).
- Merging, closing, or reopening pull requests, or acting on the default branch.
- Acting on other people's work: reviewing, approving, commenting on, or editing their pull requests and issues.
- Notifying people: requesting human reviewers, assigning, or @-mentioning someone.
- Opening issues, or deleting anything you didn't create.

### Public repositories and everywhere else: ask first

In public repositories, and when sending messages, emails, or chat posts anywhere, never post, publish, or send anything without asking first, even when the action seems implied by the task. Ask before:

- Creating, editing, or deleting comments, reviews, or reactions on issues, pull requests, or discussions.
- Opening, updating, merging, closing, or reopening pull requests or issues, including changing titles, descriptions, labels, or reviewers.
- Pushing commits or branches, or creating releases and tags on a remote.
- Sending messages, emails, or chat posts, or publishing to any external service.

Approval for one post doesn't extend to the next. Ask again for each new action, and show the exact content you intend to post.

Check a repository's visibility with `gh repo view --json visibility` rather than guessing. If you can't determine it, treat it as public.
