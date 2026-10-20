import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../src/config.ts";
import type { PullRequest } from "../src/forge.ts";
import { clip, common, render } from "../src/prompts.ts";
import {
  extractJson,
  SchemaError,
  validateAnswer,
  validateReview,
  validateVerification,
} from "../src/schemas.ts";

test("JSON is found whole, fenced, or wrapped in prose", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('Here:\n```json\n{"a":2}\n```\nDone.'), { a: 2 });
  assert.deepEqual(extractJson('I fixed it. {"a":{"b":3}} Hope that helps.'), { a: { b: 3 } });
  assert.throws(() => extractJson("nothing"), SchemaError);
});

test("reviews need well-formed findings", () => {
  const finding = { path: "a.ts", line: 3, severity: "minor", body: "x" };
  assert.deepEqual(validateReview({ summary: "ok", findings: [finding] }).findings[0], {
    ...finding,
    forAuthor: false,
  });
  assert.throws(
    () => validateReview({ summary: "ok", findings: [{ ...finding, line: 0 }] }),
    /findings\[0\]\.line/,
  );
  assert.throws(
    () => validateReview({ summary: "ok", findings: [{ ...finding, severity: "huge" }] }),
    /severity/,
  );
});

test("a fix needs a commit summary; replies don't keep one", () => {
  assert.throws(() => validateAnswer({ action: "fix", body: "done" }), /\$\.commit/);
  assert.deepEqual(validateAnswer({ action: "reply", body: "no", commit: "x" }), {
    action: "reply",
    body: "no",
  });
});

test("verifications default to no new findings", () => {
  const value = validateVerification({
    threads: [{ key: "a.ts:+3", verdict: "resolved", body: "Good." }],
  });
  assert.deepEqual(value.findings, []);
  assert.throws(
    () => validateVerification({ threads: [{ key: "k", verdict: "maybe", body: "?" }] }),
    /verdict/,
  );
});

test("prompts fill every slot, and leave braces in filled text alone", () => {
  const pr: PullRequest = {
    number: 7,
    title: "Grow ferns",
    body: "Uses {{title}} literally.",
    author: "kurt",
    draft: false,
    state: "open",
    labels: [],
    headRef: "ferns",
    headBranch: "ferns",
    headSha: "abc",
    baseRef: "main",
    baseSha: "def",
  };
  const text = common(pr, DEFAULTS);
  assert.match(text, /#7: Grow ferns/);
  assert.match(text, /Uses \{\{title\}\} literally/);
  assert.match(text, /visual checks aren't available/);
  assert.throws(() => render("common", {}), /needs \{\{visualNote\}\}/);
});

test("long text is clipped with a pointer to the rest", () => {
  assert.equal(clip("short", 10, "run git diff"), "short");
  assert.match(
    clip("x".repeat(20), 10, "run git diff"),
    /^x{10}\n… \(cut at 10 characters; run git diff\)$/,
  );
});
