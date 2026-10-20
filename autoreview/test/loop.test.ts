import "./scratch.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseConfig, type Config } from "../src/config.ts";
import { Checkout } from "../src/git.ts";
import { compose, readMarker } from "../src/markers.ts";
import { deliberate, status, type Agents, type Outcome } from "../src/loop.ts";
import { MemoryForge, type Store } from "../src/memory.ts";
import type { Answer, Review, Verification } from "../src/schemas.ts";

const FILE = ["export function grow(n) {", "  return n * 2;", "}", ""].join("\n");

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

/** A bare origin, and a clone whose `ferns` branch adds `a.ts` over `main`. */
function repository(): { origin: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), "autoreview-loop-"));
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "--quiet", origin, work]);
  git(work, "config", "user.name", "Test");
  git(work, "config", "user.email", "test@example.com");

  // main has a README; ferns adds the code under review
  writeFileSync(join(work, "README.md"), "hi\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "init");
  git(work, "push", "--quiet", "origin", "HEAD:refs/heads/main");
  git(work, "checkout", "--quiet", "-b", "ferns");
  writeFileSync(join(work, "a.ts"), FILE);
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "Add grow");
  git(work, "push", "--quiet", "origin", "HEAD:refs/heads/ferns");
  git(work, "checkout", "--quiet", "--detach");
  return { origin, work };
}

/** Scripted answers, taken in order; each may act on the checkout first. */
interface Script {
  review?: Review[];
  implement?: ((dir: string, task: string) => Answer)[];
  verify?: ((keys: string[], task: string) => Verification)[];
}

interface Setup {
  store: Store;
  work: string;
  origin: string;
  calls: { review: number; implement: number; verify: number };
  run: () => Promise<Outcome>;
}

function setup(
  script: Script,
  options: { config?: object; seed?: (store: Store) => void } = {},
): Setup {
  const { origin, work } = repository();
  const store: Store = {
    pr: {
      number: 7,
      title: "Add grow",
      body: "",
      author: "kurt",
      draft: false,
      state: "open",
      labels: ["autoreview"],
      headRef: "ferns",
      headBranch: "ferns",
      headSha: git(work, "rev-parse", "HEAD"),
      baseRef: "main",
      baseSha: git(work, "rev-parse", "main"),
    },
    diff: git(work, "diff", "main..ferns"),
    threads: [],
    comments: [],
    nextId: 1,
  };
  options.seed?.(store);

  // Agents play back the script, counting calls
  const calls = { review: 0, implement: 0, verify: 0 };
  const agents: Agents = {
    review: async () => script.review?.[calls.review++] ?? { summary: "Looks fine.", findings: [] },
    implement: async (task) => {
      const step = script.implement?.[calls.implement++];
      assert.ok(step, "unexpected implementer call");
      return step(work, task);
    },
    verify: async (task, keys) => {
      const step = script.verify?.[calls.verify++];
      assert.ok(step, "unexpected verifier call");
      return step(keys, task);
    },
  };

  const config: Config = parseConfig({ checks: ["true"], ...options.config });
  const run = () =>
    deliberate({
      number: 7,
      config,
      checkout: new Checkout(work),
      reviewer: new MemoryForge(store, "reviewer-bot"),
      implementer: new MemoryForge(store, "implementer-bot"),
      agents,
      usage: {},
      push: true,
      heavy: false,
      force: false,
      log: () => {},
    });
  return { store, work, origin, calls, run };
}

const finding = {
  path: "a.ts",
  line: 2,
  severity: "major" as const,
  body: "Doubling overflows.",
  forAuthor: false,
};
const key = "a.ts:+2";

/** Edit a.ts in the checkout and answer with a fix. */
function fix(text: string) {
  return (dir: string): Answer => {
    writeFileSync(join(dir, "a.ts"), FILE.replace("n * 2", text));
    return { action: "fix", body: "Guarded it.", commit: "Guard the doubling" };
  };
}
const reply = (): Answer => ({ action: "reply", body: "It can't overflow here." });
const verdict =
  (value: "resolved" | "follow-up" | "defer") =>
  (keys: string[]): Verification => ({
    threads: keys.map((k) => ({ key: k, verdict: value, body: `Verdict: ${value}.` })),
    findings: [],
  });

test("a clear finding is fixed, pushed, verified and resolved", async () => {
  const { store, work, origin, run } = setup({
    review: [{ summary: "One problem.", findings: [finding] }],
    implement: [fix("Math.min(n * 2, MAX)")],
    verify: [verdict("resolved")],
  });
  const outcome = await run();
  assert.equal(outcome.resolved, 1);
  assert.equal(outcome.commits.length, 1);

  // The fix is on the branch, with the branch's prefix, and the thread is resolved
  assert.equal(git(origin, "rev-parse", "ferns"), git(work, "rev-parse", "HEAD"));
  assert.equal(git(work, "log", "-1", "--format=%s"), "ferns: Guard the doubling");
  const [thread] = store.threads;
  assert.equal(thread.resolved, true);
  assert.deepEqual(
    thread.comments.map((c) => [c.author, readMarker(c.body)?.kind]),
    [
      ["reviewer-bot", "finding"],
      ["implementer-bot", "answer"],
      ["reviewer-bot", "verdict"],
    ],
  );
  assert.match(
    thread.comments[1].body,
    /^🤖 \*\*Implementer\*\* · claude-opus-5\.5 · fixed in [0-9a-f]{7}/,
  );

  // The summary records the new head, so the next run reviews nothing old
  const summary = readMarker(store.comments.at(-1)?.body ?? "");
  assert.equal(summary?.kind, "summary");
  assert.equal(summary?.head, git(work, "rev-parse", "HEAD"));
  assert.ok(!store.pr.labels.includes("needs-author"));
});

test("a disagreement defers after the exchange cap, and labels the pull request", async () => {
  const { store, calls, run } = setup({
    review: [{ summary: "One problem.", findings: [finding] }],
    implement: [reply, reply],
    verify: [verdict("follow-up"), verdict("follow-up")],
  });
  const outcome = await run();
  assert.equal(calls.implement, 2);
  assert.equal(outcome.deferred, 1);
  assert.match(store.threads[0].comments.at(-1)?.body ?? "", /still disagree/);
  assert.ok(store.pr.labels.includes("needs-author"));
});

test("a fix that keeps failing the checks is dropped and deferred with the output", async () => {
  const { store, work, calls, run } = setup(
    {
      review: [{ summary: "One problem.", findings: [finding] }],
      implement: [fix("broken("), fix("still broken(")],
    },
    { config: { checks: ["grep -q broken a.ts && echo 'syntax error' && exit 1 || true"] } },
  );
  const outcome = await run();
  assert.equal(calls.implement, 2);
  assert.equal(outcome.commits.length, 0);
  assert.equal(readFileSync(join(work, "a.ts"), "utf8"), FILE);
  assert.equal(status(store.threads[0]), "deferred");
  assert.match(
    store.threads[0].comments[1].body,
    /couldn't make a fix that passes[\s\S]*syntax error/,
  );
});

test("findings for the author, or outside the diff, never reach the implementer", async () => {
  const { store, calls, run } = setup({
    review: [
      {
        summary: "Two concerns.",
        findings: [
          { ...finding, forAuthor: true },
          { ...finding, path: "README.md", line: 1 },
        ],
      },
    ],
  });
  const outcome = await run();
  assert.equal(calls.implement, 0);
  assert.equal(outcome.deferred, 1);
  assert.match(store.comments[0].body, /Outside the diff, for the author:[\s\S]*README\.md:1/);
});

test("a rerun resumes: it verifies an answered thread and reviews nothing old", async () => {
  const { store, calls, run } = setup(
    { verify: [verdict("resolved")] },
    {
      seed: (store) => {
        // A previous run reviewed the head, and the implementer answered before it stopped
        const reviewed = {
          role: "reviewer" as const,
          kind: "review" as const,
          head: store.pr.headSha,
        };
        store.comments.push({
          id: 1,
          author: "reviewer-bot",
          body: compose("x", "Reviewed.", reviewed),
          createdAt: "",
        });
        store.threads.push({
          key,
          path: "a.ts",
          line: 2,
          side: "new",
          resolved: false,
          comments: [
            {
              id: 2,
              author: "reviewer-bot",
              body: compose("x", "Overflow.", { role: "reviewer", kind: "finding" }),
              createdAt: "",
            },
            {
              id: 3,
              author: "implementer-bot",
              body: compose("x", "No.", { role: "implementer", kind: "answer" }),
              createdAt: "",
            },
          ],
        });
      },
    },
  );
  const outcome = await run();
  assert.equal(calls.review, 0);
  assert.equal(calls.verify, 1);
  assert.equal(outcome.resolved, 1);
  assert.equal(store.threads[0].resolved, true);
});

test("a thread a person has joined is left to them", async () => {
  const { store, calls, run } = setup(
    {},
    {
      seed: (store) => {
        // A finding from an earlier review that a person has answered
        store.threads.push({
          key,
          path: "a.ts",
          line: 2,
          side: "new",
          resolved: false,
          comments: [
            {
              id: 2,
              author: "reviewer-bot",
              body: compose("x", "Overflow.", { role: "reviewer", kind: "finding" }),
              createdAt: "",
            },
            { id: 3, author: "kurt", body: "Leave this one, I'll think about it.", createdAt: "" },
          ],
        });
      },
    },
  );
  const outcome = await run();
  assert.equal(calls.implement, 0);
  assert.equal(outcome.human, 1);
  assert.match(store.comments.at(-1)?.body ?? "", /a person has joined:[\s\S]*a\.ts:2/);
});

test("threads open at the round cap go to the author", async () => {
  const { store, run } = setup(
    {
      review: [{ summary: "One problem.", findings: [finding] }],
      implement: [reply],
      verify: [verdict("follow-up")],
    },
    { config: { maxRounds: 1 } },
  );
  const outcome = await run();
  assert.equal(outcome.deferred, 1);
  assert.match(store.threads[0].comments.at(-1)?.body ?? "", /after 1 rounds/);
});

test("the run stops without replying when the branch moved", async () => {
  const { store, origin, run } = setup({
    review: [{ summary: "One problem.", findings: [finding] }],
    implement: [
      (dir) => {
        // Someone pushes to the branch while the implementer works
        const other = join(dir, "..", "other");
        execFileSync("git", ["clone", "--quiet", "-b", "ferns", origin, other]);
        git(
          other,
          "-c",
          "user.name=X",
          "-c",
          "user.email=x@x",
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          "Theirs",
        );
        git(other, "push", "--quiet", "origin", "ferns");
        return fix("Math.min(n * 2, MAX)")(dir);
      },
    ],
  });
  const outcome = await run();
  assert.match(outcome.stopped ?? "", /ferns moved/);
  assert.equal(store.threads[0].comments.length, 1);
  assert.equal(git(origin, "log", "-1", "--format=%s", "ferns"), "Theirs");
});

test("pull requests without the label, or drafts, are skipped", async () => {
  const unlabelled = setup({}, { seed: (store) => (store.pr.labels = []) });
  assert.match((await unlabelled.run()).skipped ?? "", /isn't labelled autoreview/);
  const draft = setup({}, { seed: (store) => (store.pr.draft = true) });
  assert.match((await draft.run()).skipped ?? "", /draft/);
  assert.equal(draft.store.comments.length, 0);
});

test("a rerun with nothing new posts nothing", async () => {
  const first = setup({ review: [{ summary: "Fine.", findings: [] }] });
  await first.run();
  const posted = first.store.comments.length;

  // The same pull request again, as when another label is added
  const outcome = await first.run();
  assert.match(outcome.skipped ?? "", /nothing new/);
  assert.equal(first.store.comments.length, posted);
});
