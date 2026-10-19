## Git History

Keep the default branch (`main` or `master`) linear.

- When bringing a branch into the default branch, rebase it and fast-forward rather than creating a merge commit.
- Merge commits on feature branches are fine, such as merging `main` into a branch to pick up updates. Those branches are usually squashed when their pull request lands.
- Always confirm before force pushing. Also confirm before any action that would later require a force push, such as rewriting commits that have already been pushed.
- Push with an explicit destination: `git push origin BRANCH:refs/heads/BRANCH`. With `push.default` set to `tracking` or `upstream`, a branch created from `origin/main` tracks `main`, so a plain `git push origin BRANCH` updates `main` instead of creating the branch.
