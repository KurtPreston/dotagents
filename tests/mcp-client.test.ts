// Tests for the stdio MCP client and mcp-call's output helpers, against a fake server.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient } from "../scripts/mcp/client.ts";
import { renderResult, summarize } from "../scripts/mcp/call.ts";

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-mcp-server.mjs",
);

// Start a client against the fake server, closing it when the test ends
function connect(t: { after: (fn: () => void) => void }, env: Record<string, string> = {}) {
  const client = new McpClient({ command: process.execPath, args: [FAKE], env, timeoutMs: 5000 });
  t.after(() => client.close());
  return client;
}

test("lists tools across pages and calls them", async (t) => {
  const client = connect(t);
  await client.initialize();
  const tools = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["echo", "fail"],
  );
  const result = await client.callTool("echo", { a: 1 });
  assert.equal(renderResult(result), '{"a":1}');
});

test("surfaces tool errors and protocol errors", async (t) => {
  const client = connect(t);
  await client.initialize();
  const failed = await client.callTool("fail", {});
  assert.equal(failed.isError, true);
  await assert.rejects(client.request("bogus/method"), /unknown method bogus\/method/);
});

test("rejects pending requests when the server exits", async (t) => {
  const client = connect(t, { FAKE_MCP_CRASH: "1" });
  await client.initialize();
  await assert.rejects(client.listTools(), /exited with code 3/);
});

test("summarizes descriptions to their first sentence", () => {
  assert.equal(summarize("Echo arguments back. More detail here."), "Echo arguments back.");
  assert.equal(summarize("line one\nline two"), "line one");
  assert.equal(summarize(undefined), "");
  assert.equal(summarize("x".repeat(10), 5), "xxxx…");
});

test("renders non-text content as placeholders and falls back to structured content", () => {
  assert.equal(renderResult({ content: [{ type: "image" }] }), "[image content omitted]");
  assert.equal(renderResult({ structuredContent: { ok: true } }), '{\n  "ok": true\n}');
});
