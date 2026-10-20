# autoreview

Two agents deliberate a pull request on a Gitea runner. A **reviewer** (by default `gpt-6-astra`) comments on the change. An **implementer** (by default `claude-opus-5.5`) answers each comment: it pushes a fix, replies, or defers. They go back and forth until every thread is either:

- **resolved**: the problem was clear, and the reviewer accepts the fix or the answer, or
- **deferred** to the author: the right resolution is unclear, or it would change the pull request's design. The pull request gets the `needs-author` label.

Both agents run through the Copilot CLI. A run starts when a pull request carries the `autoreview` label, and again on each push while the label stays.

## How it works

A deterministic loop (`src/loop.ts`) does all the git and Gitea work. Each agent call is one `copilot -p` run that answers with a JSON verdict, which is checked against a schema (`src/schemas.ts`) and retried once if invalid. Agents never post, push or resolve anything themselves.

1. **Review.** The reviewer reads the diff (on later runs, only the commits since the last one) and reports up to 10 findings. Findings on lines the diff shows become inline threads. The rest go in the review summary, for the author.
2. **Implement.** For each open thread, the implementer answers `fix`, `reply` or `defer`. A fix must pass the config's `checks`. It gets one retry with the failure in hand; if it still fails, it is dropped and the thread deferred, with the output. Each fix is its own commit, prefixed with the branch name. Fixes are pushed (never forced) before the replies that cite them are posted.
3. **Verify.** The reviewer gives every answered thread a verdict: `resolved` (the thread is resolved), `follow-up` (back to the implementer) or `defer`. It may raise new findings, but only on lines that round changed.
4. Rounds repeat up to `maxRounds`. A thread whose agents still disagree after `maxExchanges` answers is deferred, and so is anything open at the round cap.
5. **Summary.** A comment lists what was resolved and what is left for you, the commits, and the agent calls by model.

Rules that keep a deliberation from running away:

- Only the reviewer resolves threads.
- A deferral, by either agent, is final.
- A thread a person has commented in is left to them.
- A run with nothing new to review and no open threads posts nothing.
- A run started by the implementer's own push does nothing.
- If the branch moves during a run, the push is rejected and the run stops. The run that the push started takes over.

All state lives in the pull request. Each comment ends with a hidden marker (`<!-- autoreview {…} -->`), so a run that crashed resumes where it stopped.

## Setup

Do this once for your account:

1. Create two Gitea users, `autoreview-reviewer` and `autoreview-implementer`: Site Administration → User Accounts → Create User Account, or `gitea admin user create --username autoreview-reviewer --email … --random-password` on the server.
2. Signed in as each bot, create an access token with read and write access to repositories and issues (Settings → Applications).
3. Create a fine-grained GitHub token with the **Copilot Requests** permission, for the Copilot CLI.
4. Store the three as Actions secrets on your own account, so every repository you own can read them: `COPILOT_GITHUB_TOKEN`, `AUTOREVIEW_REVIEWER_TOKEN` and `AUTOREVIEW_IMPLEMENTER_TOKEN`. Use Settings → Actions → Secrets, or run `autoreview/add.sh <repo> --secrets`, which takes each from the environment or asks for it.

Then, for each repository:

```sh
~/Code/dotagents/autoreview/add.sh path/to/repo
```

This writes `.gitea/workflows/autoreview.yml` and `.autoreview.json` (existing files are kept), creates the `autoreview` and `needs-author` labels, and gives both bots write access. Gitea adds collaborators without an invitation. It uses your `tea` login, or `GITEA_TOKEN`. Options: `--ref` (the dotagents ref the workflow uses, default `main`), `--runs-on` (the runner label), and `--reviewer`/`--implementer` (bot names). Review the generated config's `checks`, then commit both files.

Without the bot secrets, both roles post with the workflow's built-in token, as one identity. Pushes made with that token don't start workflows, so a repository's other checks won't run on the fix commits.

## Configuration

`.autoreview.json` at the repository root. Every field is optional:

| Field                     | Default                                                 | Meaning                                                                                                                |
| ------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `reviewer`, `implementer` | `gpt-6-astra`, `claude-opus-5.5`, both at `high` effort | `{ "model": "…", "effort": "…" }` for each role: any model the Copilot CLI accepts                                     |
| `checks`                  | `[]`                                                    | Commands a fix must pass before it is pushed                                                                           |
| `heavyChecks`             | `[]`                                                    | Slower checks (tests, renders), run only with `heavy: true` on the action. Until then the implementer may not run them |
| `visual`                  | `false`                                                 | Whether visual results can be checked. While it's false, findings that can only be judged by eye are deferred          |
| `maxRounds`               | `3`                                                     | Implement-and-verify rounds per run                                                                                    |
| `maxExchanges`            | `2`                                                     | Answers a thread may get before it is deferred as a disagreement                                                       |
| `context`                 | `["AGENTS.md"]`                                         | Files the agents read first for the project's conventions                                                              |
| `label`, `deferLabel`     | `autoreview`, `needs-author`                            | The label that asks for a deliberation, and the one marking threads left to you                                        |
| `agentTimeoutMinutes`     | `20`                                                    | How long one agent call may run                                                                                        |

The config is read from the pull request's head, so a pull request can change its own checks.

## The action

`action.yml` is a composite action. It sets up Node and the Copilot CLI, installs dotagents' Copilot instructions and settings into a temporary `COPILOT_HOME` (so the agents follow the standing instructions and add no attribution trailers), points the checkout's `origin` at the implementer's token (`setup-git.sh`), and runs the loop. Its inputs are `copilot-token`, `reviewer-token`, `implementer-token`, `token` (the fallback), `pr`, `heavy` and `copilot-version`.

The workflow template installs the project's npm dependencies first, when it has a lockfile, so the checks can run.

## Running it locally

```sh
cd autoreview
./src/autoreview.ts run --pr 42 --repo path/to/repo --dry-run
```

`--dry-run` deliberates against an in-memory copy of the pull request. It prints every comment it would post, makes commits only in a temporary worktree, and pushes nothing. Without `--dry-run`, it posts and pushes for real, with your `tea` login (or `GITEA_TOKEN`) as one identity, or as the two bots when `AUTOREVIEW_REVIEWER_TOKEN` and `AUTOREVIEW_IMPLEMENTER_TOKEN` are set. `--force` deliberates without the label, or on a draft or closed pull request. `threads --pr 42` lists a pull request's review threads.

Agent calls write their task and answer under `$TMPDIR/autoreview-<role>-*`, and the directory is kept when a call fails. Node runs with `--use-system-ca`, so servers with a private certificate authority work when the system trusts it.

## Development

The tool is TypeScript run directly by Node's type stripping (Node 22.18 or later), with no build step and no runtime dependencies. Avoid syntax that stripping rejects: enums, namespaces, and constructor parameter properties.

```sh
npm ci
npm run typecheck && npm run lint && npm run format:check && npm test
```

The tests run whole deliberations against a real git repository with a bare origin, an in-memory forge (`src/memory.ts`), and scripted agents. They also run the agent runner against a fake Copilot CLI (`test/fake-copilot.ts`).

## Not yet

- GitHub. The `Forge` interface leaves room for it: it needs a GitHub App identity, and threads resolved through GraphQL.
- Visual verification and heavy checks, which wait for a stronger runner. When they arrive, set the workflow's `runs-on`, pass `heavy: true`, and set `visual` once the implementer can render and attach pictures.
- Threads opened by people. The agents only take part in threads the reviewer opened.
