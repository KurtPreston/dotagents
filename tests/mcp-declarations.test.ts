// Unit tests for loading declarations, resolving commands, and rendering entries.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadDeclarations, loadServers, resolveCommand } from "../scripts/mcp/declarations.ts";
import { InstallError, parseDocument } from "../scripts/lib/json.ts";
import { TARGETS, sameEntry, targetEnv } from "../scripts/mcp/targets.ts";

// Name and label are irrelevant to rendering, so tests fill them in
const render = (
  target: keyof typeof TARGETS,
  fields: { command: string; args: string[]; env: Record<string, string>; tools?: string[] },
) => TARGETS[target].render({ name: "x", label: "x", ...fields });

// Make a fresh temporary directory removed after the test
function tempDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-mcp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Write a plugin's mcp/<name>.json, given "plugin/name", with raw text or a JSON value
function declare(root: string, spec: string, content: unknown) {
  const [plugin = "", name = ""] = spec.split("/");
  const file = path.join(root, plugin, "mcp", `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return path.join(root, plugin);
}

// Create an executable stub so PATH lookups have something to find
function executable(dir: string, name: string) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
  return file;
}

test("loads declarations in plugin order and fills defaults", (t) => {
  const root = tempDir(t);
  const first = declare(root, "alpha/zeta", { command: "npx", args: ["-y", "pkg"] });
  declare(root, "alpha/beta", { command: "example-tool", env: { A: "1" } });
  const second = declare(root, "omega/gamma", { command: "/bin/sh" });
  fs.writeFileSync(path.join(first, "mcp", "README.md"), "ignored");

  const servers = loadDeclarations([first, second]);
  assert.deepEqual(
    servers.map((server) => server.name),
    ["beta", "zeta", "gamma"],
  );
  assert.deepEqual(servers[0], {
    name: "beta",
    plugin: "alpha",
    label: "plugins/alpha/mcp/beta.json",
    command: "example-tool",
    args: [],
    env: { A: "1" },
  });
});

test("keeps load and tools only when set", (t) => {
  const root = tempDir(t);
  const plugin = declare(root, "p/lazy", { command: "npx", load: "on-demand", tools: ["a"] });
  declare(root, "p/plain", { command: "npx", load: "static" });
  const [lazy, plain] = loadDeclarations([plugin]);
  assert.equal(lazy.onDemand, true);
  assert.deepEqual(lazy.tools, ["a"]);
  assert.ok(!("onDemand" in plain) && !("tools" in plain));
});

test("skips plugins without an mcp folder", (t) => {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, "empty"));
  assert.deepEqual(loadDeclarations([path.join(root, "empty")]), []);
});

test("rejects invalid declarations", async (t) => {
  const cases: Record<string, [unknown, RegExp]> = {
    "unknown key": [{ command: "npx", url: "https://example.com" }, /unsupported key "url"/],
    "missing command": [{ args: [] }, /"command" must be a non-empty string/],
    "empty command": [{ command: "" }, /"command" must be a non-empty string/],
    "non-string args": [{ command: "npx", args: [1] }, /"args" must be an array of strings/],
    "array env": [{ command: "npx", env: [] }, /"env" must be an object of strings/],
    "non-string env": [{ command: "npx", env: { A: 1 } }, /"env" must be an object of strings/],
    comments: ['{ // no\n "command": "npx" }', /invalid JSON/],
    "duplicate key": ['{"command": "a", "command": "b"}', /duplicate JSON key/],
    "array root": ["[]", /root must be an object/],
    "bad load": [{ command: "npx", load: "lazy" }, /"load" must be "static" or "on-demand"/],
    "empty tools": [{ command: "npx", tools: [] }, /"tools" must be a non-empty array/],
    "non-string tools": [{ command: "npx", tools: [1] }, /"tools" must be a non-empty array/],
  };
  for (const [description, [content, pattern]] of Object.entries(cases)) {
    await t.test(description, (t) => {
      const plugin = declare(tempDir(t), "p/server", content);
      assert.throws(() => loadDeclarations([plugin]), pattern);
    });
  }
});

test("rejects bad names and duplicates across plugins", (t) => {
  const root = tempDir(t);
  assert.throws(
    () => loadDeclarations([declare(root, "p/Bad.Name", { command: "x" })]),
    /server names must match/,
  );

  const other = tempDir(t);
  const first = declare(other, "one/shared", { command: "x" });
  const second = declare(other, "two/shared", { command: "x" });
  assert.throws(
    () => loadDeclarations([first, second]),
    /'shared' is in both plugins\/one and plugins\/two/,
  );
});

test("resolves bare names on PATH, first match wins", (t) => {
  const root = tempDir(t);
  const early = executable(path.join(root, "early"), "npx");
  executable(path.join(root, "late"), "npx");
  fs.writeFileSync(path.join(root, "late", "plain"), "not executable", { mode: 0o644 });
  const searchPath = [
    "relative/ignored",
    path.join(root, "missing"),
    path.join(root, "early"),
    path.join(root, "late"),
  ].join(path.delimiter);

  assert.equal(resolveCommand("npx", { home: root, searchPath, label: "x" }), early);
  assert.throws(
    () => resolveCommand("plain", { home: root, searchPath, label: "x" }),
    /"plain" was not found on PATH/,
  );
  assert.throws(
    () => resolveCommand("npx", { home: root, searchPath: "", label: "x" }),
    /not found on PATH/,
  );
});

test("resolves absolute and home-relative paths, and rejects relative ones", (t) => {
  const home = tempDir(t);
  const tool = executable(path.join(home, ".config", "tool"), "example-tool");
  const options = { home, searchPath: "", label: "x" };

  assert.equal(resolveCommand(tool, options), tool);
  assert.equal(resolveCommand("~/.config/tool/example-tool", options), tool);
  assert.throws(() => resolveCommand("~/missing", options), /not an executable file/);
  assert.throws(() => resolveCommand("bin/tool", options), /must be a bare name/);
});

test("loadServers resolves every command before returning", (t) => {
  const root = tempDir(t);
  const npx = executable(path.join(root, "bin"), "npx");
  const plugin = declare(root, "p/linear", { command: "npx", args: ["-y", "mcp-remote"] });
  const [server] = loadServers([plugin], { home: root, searchPath: path.join(root, "bin") });
  assert.equal(server.command, npx);

  declare(root, "p/other", { command: "missing" });
  assert.throws(
    () => loadServers([plugin], { home: root, searchPath: path.join(root, "bin") }),
    InstallError,
  );
});

test("renders each target's entry shape", () => {
  const server = { command: "/bin/npx", args: ["-y"], env: {} };
  assert.deepEqual(render("zed", server), { command: "/bin/npx", args: ["-y"], env: {} });
  assert.deepEqual(render("cursor", server), { command: "/bin/npx", args: ["-y"], env: {} });
  assert.deepEqual(render("claude", server), {
    type: "stdio",
    command: "/bin/npx",
    args: ["-y"],
    env: {},
  });
  assert.deepEqual(render("copilot", server), {
    type: "stdio",
    command: "/bin/npx",
    args: ["-y"],
    tools: ["*"],
  });
  assert.deepEqual(render("copilot", { ...server, env: { A: "1" } }).env, { A: "1" });
  assert.deepEqual(render("copilot", { ...server, tools: ["a"] }).tools, ["a"]);
});

test("target files follow install.sh defaults and overrides", () => {
  const defaults = targetEnv({ HOME: "/h" });
  assert.equal(TARGETS.zed.file(defaults), "/h/.config/zed/settings.json");
  assert.equal(TARGETS.copilot.file(defaults), "/h/.copilot/mcp-config.json");
  assert.equal(TARGETS.claude.file(defaults), "/h/.claude.json");
  assert.equal(TARGETS.cursor.file(defaults), "/h/.cursor/mcp.json");
  assert.equal(defaults.AGENTS_HOME, "/h/.agents");

  const custom = targetEnv({ HOME: "/h", ZED_HOME: "/z", COPILOT_HOME: "/c", CURSOR_HOME: "/u" });
  assert.equal(TARGETS.zed.file(custom), "/z/settings.json");
  assert.equal(TARGETS.copilot.file(custom), "/c/mcp-config.json");
  assert.equal(TARGETS.cursor.file(custom), "/u/mcp.json");
});

test("sameEntry ignores key order and defaults missing args and env", () => {
  assert.ok(
    sameEntry(
      { command: "a", env: { B: "1", A: "2" } },
      { env: { A: "2", B: "1" }, args: [], command: "a" },
    ),
  );
  assert.ok(sameEntry({ command: "a" }, { command: "a", args: [], env: {} }));
  assert.ok(!sameEntry({ command: "a", args: ["x"] }, { command: "a" }));
  assert.ok(!sameEntry({ command: "a" }, "a"));
});

test("parseDocument accepts JSONC only when asked", () => {
  const text = '{\n  // comment\n  "a": 1,\n}';
  assert.deepEqual(parseDocument(text, { jsonc: true, label: "x" }).value, { a: 1 });
  assert.throws(() => parseDocument(text, { label: "x" }), /x: invalid JSON/);
  assert.throws(() => parseDocument("", { jsonc: true, label: "x" }), /invalid JSON/);
});
