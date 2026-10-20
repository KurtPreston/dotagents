# Plan: autoreview

## Goal

When a pull request on Gitea carries the `autoreview` label, a Gitea Actions
job runs two Copilot CLI agents that deliberate it. A reviewer
(`gpt-6-astra`) comments, and an implementer (`claude-opus-5.5`) fixes,
replies, or pushes back. They go back and forth until every thread is either
resolved (the issue was clear, and the reviewer accepts the fix or the
answer) or deferred to the author (the right resolution is unclear, or it
would change the pull request's design). Everything runs on the runner, so
the owner's laptop isn't needed.

The tool lives in dotagents so any repository can adopt it with one command.

## Scope

In:

- `autoreview/`: a TypeScript tool (run by Node's type stripping, no build
  step), a composite action, workflow templates, and `add.sh` to enable a
  repository.
- Gitea forge client: reviews, inline comments, replies, resolve, labels,
  collaborators, and user-level secrets.
- Two bot identities (`autoreview-reviewer`, `autoreview-implementer`) from
  user-level Actions secrets, falling back to the workflow's built-in token
  as a single identity.
- Config in `.autoreview.json`: models, effort, checks, `heavyChecks` and
  `visual` (both off until a stronger runner exists), round cap, and context
  files.
- Enabling forest-game: workflow, config, and an AGENTS.md line saying pull
  requests get the `autoreview` label by default.

Out (follow-ups):

- GitHub forge (a GitHub App identity, threads resolved through GraphQL). The
  forge interface and workflow template leave room for it.
- Visual verification (shots, before-and-after pictures) and heavy checks:
  config switches exist, but they're implemented once the stronger runner
  arrives.

## Design summary

- A deterministic loop (`autoreview.ts`) does all git and forge work. Each
  agent call is one `copilot -p` run that returns a JSON verdict, checked
  against a schema. Agents never post, push, or resolve.
- Round 1: the reviewer's findings `{path, line, severity, body}` are posted
  as one review. Then each round runs the implementer, then the verifier:
  - Implementer, per open thread: `fix` (edits in the worktree), `reply`
    (disagrees, with reasons), or `defer`. The loop runs `checks`, commits
    `autoreview: <summary>`, pushes (never forced), and posts replies
    citing the commit.
  - Reviewer, per thread: `resolved`, `follow-up`, or `defer`. After round
    1 it may raise new findings only on lines the implementer changed.
- Only the reviewer resolves. Either agent can defer, and a deferral is
  final. A thread still disputed after 2 exchanges defers as "agents
  disagree". A human comment on a thread takes it out of the agents' hands.
  If checks fail after one retry, that thread's change is reverted and the
  thread deferred, with the output.
- State lives in Gitea: hidden markers in comment bodies
  (`<!-- autoreview:{"thread":3,"round":2,"role":"implementer","head":"<sha>"} -->`)
  let a run resume, and let a later run review only commits since the last
  reviewed head.
- Finishing: a summary comment lists what was fixed, what is deferred (with
  both positions), and how many agent calls were made. Deferred threads add
  a `needs-author` label. Every comment the agents write starts with 🤖 and
  its role and model.
- The trigger is `pull_request` (`labeled`, `synchronize`), gated on the
  `autoreview` label and on the PR not being a draft. A run is skipped when
  the push came from the implementer bot, and a concurrency group per PR
  keeps runs from overlapping. If someone else pushes during a run, the
  bot's push is rejected, so the run stops and the newer run takes over.
- Agent permissions: the reviewer can read and run read-only git commands.
  The implementer can edit inside the checkout and run the configured
  checks, but not `git push`, nor `heavyChecks` unless they're enabled.
- The runner gets dotagents' Copilot settings (`install.sh copilot` into a
  temporary `COPILOT_HOME`), so the agents follow the standing instructions
  and add no attribution trailers.

## Execution rules

- All work happens on the `autoreview` branch: in dotagents, in the
  worktree `~/Code/dotagents-autoreview` (leave the main checkout on
  `main`, since its skills are live-linked into agent configs). In
  forest-game, the existing `autoreview` worktree. One plan, one branch, one
  commit per phase.
- Prefix every commit message with `autoreview: `.
- For each phase: implement only its scope, run validation, fix failures, commit.
- Work around small obstacles and log them under Obstacles. Stop only if a
  fundamental assumption is wrong or a finding reshapes the effort.
- Log existing bugs found along the way under Found bugs. Fold in fixes that
  belong to this effort, save small unrelated fixes for their own branches,
  and leave nuanced ones unfixed for discussion.
- After the last phase: update docs and commit, delete this file and commit,
  open a pull request (draft where supported; ask first only if the
  repository is public), fix each small unrelated bug on its own
  branch from the base branch with its own pull request, then report results
  with every obstacle and workaround, every bug found and how it was handled,
  and how the user can try the changes.
- dotagents is public on GitHub: show the exact pull request title and
  description, and ask before pushing or opening it. forest-game is
  private: push and open its pull request without asking.

## Validation

dotagents:

- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`
- In `autoreview/`: `npm run typecheck`, `npm run lint`,
  `npm run format:check`, and `npm test` (`node --test`)

forest-game (phase 6): `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm run build`, and `npm test`.

## User steps

Before phase 6's end-to-end trial:

1. Create two Gitea users, `autoreview-reviewer` and
   `autoreview-implementer` (Site Administration, then User Accounts, then
   Create User Account; or `gitea admin user create --username
   autoreview-reviewer --email … --random-password` on the server).
2. Signed in as each bot, create an access token with `repository` and
   `issue` read/write scopes (Settings, then Applications).
3. Create a fine-grained GitHub token with the "Copilot Requests"
   permission, for the Copilot CLI.
4. Store the three as user-level Actions secrets on your account (Settings,
   then Actions, then Secrets): `AUTOREVIEW_REVIEWER_TOKEN`,
   `AUTOREVIEW_IMPLEMENTER_TOKEN`, and `COPILOT_GITHUB_TOKEN`. Or run
   `autoreview/add.sh --secrets`, which prompts for each and stores it
   through the API.
5. Push the dotagents `autoreview` branch (after approving it), so the
   runner can fetch the action. Until it merges, forest-game's workflow
   pins `@autoreview`.

## Phases

### Phase 1: Scaffold, config, and Gitea client

- `autoreview/package.json` (`type: module`; dev deps only: `typescript`,
  `@types/node`, `oxlint`, `oxfmt`), `tsconfig.json` (`noEmit`,
  `erasableSyntaxOnly`), and npm scripts for typecheck, lint, format, and
  test.
- `src/config.ts`: load and validate `.autoreview.json` with defaults.
- `src/forge.ts`: a `Forge` interface. `src/gitea.ts` implements it with
  `fetch`: PR and diff, review threads with comments and resolution state,
  posting a review with inline comments, replies, resolve, labels, and
  collaborator add.
- Tests: config defaults and validation, and the Gitea client against a
  stubbed `fetch` (request shapes, and parsing of recorded responses).
- Done: validation passes, and the client lists a real PR's threads from
  the command line (`node src/gitea.ts --pr …`, read-only).

### Phase 2: Agent runner

- `src/agent.ts`: run `copilot -p` with `--model`, `--reasoning-effort`, a
  role's `--allow-tool`/`--deny-tool` set, and `--output-format json`.
  Extract the final message's JSON, validate it against the role's schema
  (`src/schemas.ts`, hand-written validators), retry once with the error,
  and time out.
- `prompts/reviewer.md`, `prompts/implementer.md`, `prompts/verifier.md`:
  the role, the deferral criteria (the repo's design docs, public APIs or
  formats, new dependencies, judgement calls), and the verdict format.
  Repository context comes from the config's `context` files.
- Tests: a fake `copilot` executable on `PATH` returning canned output
  (valid, invalid then valid, timeout).
- Done: one real reviewer call against a sample diff returns valid findings
  locally.

### Phase 3: The deliberation loop

- `src/loop.ts`: round 1 review; rounds of implement, check, commit, push,
  reply, then verify, resolve, or follow up; the deferral rules, the
  disagreement cap, human takeover, revert on failed checks, and the round
  cap; the summary comment and the `needs-author` label.
- `src/markers.ts`: write and parse hidden state markers. Rebuild state
  from the forge, so a rerun resumes and reviews only new commits.
- `src/autoreview.ts`: the command line (`--pr`, `--repo`, `--dry-run`,
  which prints the posts instead of making them).
- Tests: whole runs against an in-memory forge and scripted agents
  (straight resolve, disagreement then defer, failed checks then revert,
  resume after a crash, human takeover, round cap).
- Done: `--dry-run` on a real forest-game PR prints a plausible
  deliberation.

### Phase 4: Composite action

- `autoreview/action.yml`: set up Node, install `@github/copilot`, run
  `install.sh copilot` with a temporary `COPILOT_HOME`, pick the bot tokens
  or fall back to the built-in token, set the git identity of the poster,
  and run `autoreview.ts`.
- The workflow-level guards (label, draft, bot sender, concurrency) go in
  the template in phase 5, and the action checks them again, so a
  hand-written workflow is safe too.
- Done: an action-level check in tests (the `action.yml` inputs match what
  `autoreview.ts` reads), and validation passes.

### Phase 5: `add.sh` and workflow templates

- `templates/gitea.yml` (and `templates/github.yml`, marked as waiting for
  the GitHub forge), and `templates/autoreview.json`.
- `autoreview/add.sh <repo-path> [--secrets]`: write the workflow and
  config if absent, create the `autoreview` and `needs-author` labels, add
  both bots as collaborators with write access, and optionally store the
  user-level secrets. It reads the Gitea host, owner, and repo from
  `origin`, and the token from tea's config or `GITEA_TOKEN`.
- Tests: `add.sh` against a temporary repository and a stubbed API (python
  `unittest`, alongside the existing installer tests).
- Done: validation passes.

### Phase 6: Enable forest-game and trial it

- In the forest-game `autoreview` worktree: run `add.sh` (checks
  `npm run lint` and `npm run build`; `heavyChecks` empty; `visual: false`;
  pinned to `@autoreview` until dotagents merges). Add to AGENTS.md (Git
  and pull requests) that pull requests get the `autoreview` label by
  default.
- Trial: once the user steps are done, open a small real forest-game PR
  with the label, and watch the run through to the summary. Fix what it
  shows.
- Done: forest-game validation passes, and one PR has been deliberated end
  to end.

## Obstacles

- Node's `fetch` rejected the Gitea server's certificate (private CA,
  trusted by the system keychain): the CLI runs with `--use-system-ca`
  (shebang), and the action must do the same or set `NODE_EXTRA_CA_CERTS`.
- No forest-game PR has review threads yet, so thread grouping is tested
  against Gitea's documented shapes only; the phase 6 trial checks it live.
- Copilot CLI first failed to authenticate on the development machine; it
  worked later (signed in meanwhile). Agent output is read from `-s` (final
  answer only) rather than the JSONL event stream, whose format isn't
  documented.
- Gitea reports a deleted head branch as `refs/pull/N/head`: checkouts fetch
  through the pull ref, and pushes go to `headBranch`, which is undefined
  for deleted or forked heads (such pull requests are skipped).
- The review summary is posted as a conversation comment rather than the
  review's body, since Gitea's comment list omits review bodies and the
  summary's marker must be readable to resume.
- `add.sh` becomes a thin wrapper around `src/add.ts`, tested with
  `node --test` rather than Python, since the tool is TypeScript.

## Found bugs
