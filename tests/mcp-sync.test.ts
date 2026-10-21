// Tests for editing agent configs: adoption, conflicts, pruning, and safe writes.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setServer, sync } from "../scripts/mcp/sync.ts";
import type { SyncOptions } from "../scripts/mcp/sync.ts";
import type { Server } from "../scripts/mcp/targets.ts";
import { targetEnv } from "../scripts/mcp/targets.ts";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "mcp",
  "sync-mcp.ts",
);
const ZED_SETTINGS = `// Zed settings
{
  "theme": "One Dark", // keep this comment
  "context_servers": {
    // hand-added server
    "mine": { "command": "/bin/mine", "args": [], "env": {} }
  },
}
`;

// Build temporary homes and a sync() wrapper that captures its log
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = targetEnv({ HOME: path.join(root, "home") });
  fs.mkdirSync(env.HOME, { recursive: true });
  const logs: string[] = [];
  const run = (servers: Server[], targets: string[], options: Partial<SyncOptions> = {}) =>
    sync({ servers, targets, env, log: (line) => logs.push(line), ...options });
  return { root, env, logs, run };
}

// Write a file, creating its parent folder
function write(file: string, text: string, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
  fs.chmodSync(file, mode);
}

const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const server = (name: string, command = `/bin/${name}`): Server => ({
  name,
  label: `plugins/p/mcp/${name}.json`,
  command,
  args: ["--x"],
  env: {},
});
const backups = (file: string) =>
  fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.startsWith(`${path.basename(file)}.`) && name.endsWith(".bak"));

const entry = { command: "/bin/linear", args: ["--x"], env: {} };
const ENTRY_TEXT = (indent: string) =>
  [
    '"linear": {',
    '  "command": "/bin/linear",',
    '  "args": [',
    '    "--x"',
    "  ],",
    '  "env": {}',
    "}",
  ]
    .map((line, i) => (i === 0 ? line : indent + line))
    .join("\n");

test("setServer appends on its own line, keeping neighbors and their comments", () => {
  const text = '{\n  "s": {\n    "mine": { "command": "/m" } // note\n  }\n}\n';
  assert.equal(
    setServer(text, ["s", "linear"], entry),
    `{\n  "s": {\n    "mine": { "command": "/m" }, // note\n    ${ENTRY_TEXT("    ")}\n  }\n}\n`,
  );
});

test("setServer follows a trailing-comma style", () => {
  const text = '{\n  "s": {\n    "mine": {},\n  },\n}\n';
  assert.equal(
    setServer(text, ["s", "linear"], entry),
    `{\n  "s": {\n    "mine": {},\n    ${ENTRY_TEXT("    ")},\n  },\n}\n`,
  );
});

test("setServer creates the servers key after the last root property", () => {
  assert.equal(
    setServer('{\n  "theme": "x" // c\n}\n', ["s", "linear"], entry),
    `{\n  "theme": "x", // c\n  "s": {\n    ${ENTRY_TEXT("    ")}\n  }\n}\n`,
  );
  assert.deepEqual(JSON.parse(setServer("{}\n", ["s", "linear"], entry)), { s: { linear: entry } });
  assert.deepEqual(JSON.parse(setServer('{"s": {}}', ["s", "linear"], entry)), {
    s: { linear: entry },
  });
});

test("setServer replaces a server without touching its siblings", () => {
  const text = `{\n  "s": {\n    "mine": { "command": "/m" }, // note\n    ${ENTRY_TEXT("    ")}\n  }\n}\n`;
  const replaced = setServer(text, ["s", "linear"], { command: "/new", args: [], env: {} });
  assert.ok(replaced.includes('"mine": { "command": "/m" }, // note\n'));
  assert.deepEqual(JSON.parse(replaced.replace(" // note", "")).s.linear, {
    command: "/new",
    args: [],
    env: {},
  });
});

test("setServer removes whole lines and fixes the comma it leaves behind", () => {
  const base = '{\n  "s": {\n    "mine": { "command": "/m" } // note\n  }\n}\n';
  const added = setServer(base, ["s", "linear"], entry);
  assert.equal(setServer(added, ["s", "linear"], undefined), base);

  // Removing a middle server keeps both neighbors exactly
  const middle = '{\n  "s": {\n    "a": 1,\n    "b": 2,\n    "c": 3\n  }\n}\n';
  assert.equal(
    setServer(middle, ["s", "b"], undefined),
    '{\n  "s": {\n    "a": 1,\n    "c": 3\n  }\n}\n',
  );
  const trailing = '{\n  "s": {\n    "a": 1,\n    "b": 2,\n  },\n}\n';
  assert.equal(setServer(trailing, ["s", "b"], undefined), '{\n  "s": {\n    "a": 1,\n  },\n}\n');
  assert.equal(setServer(middle, ["s", "missing"], undefined), middle);
  assert.deepEqual(JSON.parse(setServer('{"s": {"a": 1, "b": 2}}', ["s", "a"], undefined)), {
    s: { b: 2 },
  });
});

test("edits Zed settings while keeping comments and unrelated keys", (t) => {
  const { env, run } = fixture(t);
  const file = path.join(env.ZED_HOME, "settings.json");
  write(file, ZED_SETTINGS);
  run([server("linear")], ["zed"]);

  const text = fs.readFileSync(file, "utf8");
  for (const comment of ["// Zed settings", "// keep this comment", "// hand-added server"]) {
    assert.ok(text.includes(comment), comment);
  }
  assert.ok(text.includes('"theme": "One Dark"'));
  assert.ok(text.includes('"linear": {'));
  assert.ok(text.includes('"mine": { "command": "/bin/mine"'));
});

test("creates missing configs owner-only with each target's shape", (t) => {
  const { env, run } = fixture(t);
  run([server("linear")], ["zed", "copilot", "claude", "cursor"]);

  const expected: Record<string, [string, unknown]> = {
    [path.join(env.ZED_HOME, "settings.json")]: [
      "context_servers",
      { command: "/bin/linear", args: ["--x"], env: {} },
    ],
    [path.join(env.COPILOT_HOME, "mcp-config.json")]: [
      "mcpServers",
      { type: "stdio", command: "/bin/linear", args: ["--x"], tools: ["*"] },
    ],
    [path.join(env.HOME, ".claude.json")]: [
      "mcpServers",
      { type: "stdio", command: "/bin/linear", args: ["--x"], env: {} },
    ],
    [path.join(env.CURSOR_HOME, "mcp.json")]: [
      "mcpServers",
      { command: "/bin/linear", args: ["--x"], env: {} },
    ],
  };
  for (const [file, [key, entry]] of Object.entries(expected)) {
    assert.deepEqual(read(file), { [key]: { linear: entry } });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.deepEqual(read(path.join(env.AGENTS_HOME, "state", "mcp.json")), {
    zed: ["linear"],
    copilot: ["linear"],
    claude: ["linear"],
    cursor: ["linear"],
  });
});

test("keeps other keys in Claude's app state file and its permissions", (t) => {
  const { env, run } = fixture(t);
  const file = path.join(env.HOME, ".claude.json");
  write(file, JSON.stringify({ numStartups: 3, projects: { a: {} } }), 0o640);
  run([server("linear")], ["claude"]);

  const value = read(file);
  assert.equal(value.numStartups, 3);
  assert.deepEqual(value.projects, { a: {} });
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

test("a rerun leaves files untouched, with no backups", (t) => {
  const { env, logs, run } = fixture(t);
  const file = path.join(env.CURSOR_HOME, "mcp.json");
  run([server("linear")], ["cursor"]);
  const before = fs.statSync(file, { bigint: true });
  const bytes = fs.readFileSync(file);

  run([server("linear")], ["cursor"]);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.statSync(file, { bigint: true }).mtimeNs, before.mtimeNs);
  assert.deepEqual(backups(file), []);
  assert.equal(logs.at(-1), `unchanged ${file}`);
});

test("backs up changed files with their original bytes, owner-only", (t) => {
  const { env, run } = fixture(t);
  const file = path.join(env.CURSOR_HOME, "mcp.json");
  write(file, '{"mcpServers": {}}\n');
  run([server("linear")], ["cursor"]);

  const [backup] = backups(file);
  const backupPath = path.join(env.CURSOR_HOME, backup);
  assert.equal(fs.readFileSync(backupPath, "utf8"), '{"mcpServers": {}}\n');
  assert.equal(fs.statSync(backupPath).mode & 0o777, 0o600);
});

test("adopts an identical hand-added server and refuses a different one", (t) => {
  const { env, run } = fixture(t);
  const file = path.join(env.CURSOR_HOME, "mcp.json");
  write(
    file,
    JSON.stringify({ mcpServers: { linear: { args: ["--x"], command: "/bin/linear" } } }),
  );
  const bytes = fs.readFileSync(file);
  run([server("linear")], ["cursor"]);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(read(path.join(env.AGENTS_HOME, "state", "mcp.json")), { cursor: ["linear"] });

  // A conflicting entry on another target fails without writing anything
  const other = path.join(env.HOME, ".claude.json");
  write(other, JSON.stringify({ mcpServers: { linear: { command: "/elsewhere" } } }));
  const otherBytes = fs.readFileSync(other);
  assert.throws(
    () => run([server("linear")], ["cursor", "claude"]),
    /already has a "linear" server that dotagents didn't install/,
  );
  assert.deepEqual(fs.readFileSync(other), otherBytes);
});

test("replaces managed servers and prunes ones no longer declared", (t) => {
  const { env, run } = fixture(t);
  const file = path.join(env.ZED_HOME, "settings.json");
  write(file, ZED_SETTINGS);
  run([server("linear"), server("slack")], ["zed"]);
  run([server("linear", "/new/linear")], ["zed"]);

  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.includes('"command": "/new/linear"'));
  assert.ok(!text.includes('"slack"'));
  assert.ok(text.includes('"mine"'), "hand-added servers are never pruned");
  assert.deepEqual(read(path.join(env.AGENTS_HOME, "state", "mcp.json")), { zed: ["linear"] });
});

test("only selected targets are touched or pruned", (t) => {
  const { env, run } = fixture(t);
  run([server("linear")], ["cursor", "claude"]);
  run([], ["cursor"]);

  assert.deepEqual(read(path.join(env.CURSOR_HOME, "mcp.json")), { mcpServers: {} });
  assert.ok(read(path.join(env.HOME, ".claude.json")).mcpServers.linear);
  assert.deepEqual(read(path.join(env.AGENTS_HOME, "state", "mcp.json")), {
    cursor: [],
    claude: ["linear"],
  });
});

test("check mode writes nothing", (t) => {
  const { root, env, logs, run } = fixture(t);
  run([server("linear")], ["zed", "cursor"], { check: true });
  assert.deepEqual(fs.readdirSync(root), ["home"]);
  assert.deepEqual(fs.readdirSync(env.HOME), []);
  assert.equal(logs.length, 2);
});

test("rejects symlinks, malformed files, bad server maps, and unknown targets", (t) => {
  const { root, env, run } = fixture(t);
  const cursor = path.join(env.CURSOR_HOME, "mcp.json");
  write(path.join(root, "real.json"), "{}");
  fs.mkdirSync(env.CURSOR_HOME, { recursive: true });
  fs.symlinkSync(path.join(root, "real.json"), cursor);
  assert.throws(() => run([server("a")], ["cursor"]), /must be a regular file/);

  write(path.join(env.HOME, ".claude.json"), "{ // comments are not JSON\n}");
  assert.throws(() => run([server("a")], ["claude"]), /invalid JSON/);
  write(path.join(env.COPILOT_HOME, "mcp-config.json"), '{"mcpServers": []}');
  assert.throws(() => run([server("a")], ["copilot"]), /"mcpServers" must be an object/);
  assert.throws(() => run([server("a")], ["vscode"]), /unknown MCP target 'vscode'/);
});

test("CLI resolves commands and reports errors without a stack trace", (t) => {
  const { root, env } = fixture(t);
  const plugin = path.join(root, "plugins", "p");
  write(path.join(plugin, "mcp", "tool.json"), JSON.stringify({ command: "tool", args: [] }));
  write(path.join(root, "bin", "tool"), "#!/bin/sh\n", 0o755);
  const childEnv = { HOME: env.HOME, PATH: path.join(root, "bin") };
  const args = [SCRIPT, "--plugins", plugin, "--targets", "cursor"];

  execFileSync(process.execPath, args, { env: childEnv });
  assert.equal(
    read(path.join(env.CURSOR_HOME, "mcp.json")).mcpServers.tool.command,
    path.join(root, "bin", "tool"),
  );

  const failed = spawnSync(process.execPath, args, {
    env: { HOME: env.HOME, PATH: "" },
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(
    failed.stderr,
    /^error: plugins\/p\/mcp\/tool.json: command "tool" was not found on PATH/,
  );
});
