// Tests for editing server tables in TOML configs, such as Codex's config.toml.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseToml, setTomlServer } from "../scripts/mcp/toml.ts";

const KEY: [string, string] = ["mcp_servers", "linear"];
const entry = { command: "/bin/linear", args: ["--x"] };
const set = (text: string, value?: Record<string, unknown>, keys = KEY) =>
  setTomlServer(text, keys, { value, label: "config.toml" });

const CONFIG = `# Codex settings
model = "gpt-5" # keep this comment

[mcp_servers.mine]
command = "/bin/mine"

[profiles.fast]
model = "fast"
`;

test("setTomlServer appends a table, keeping every other line", () => {
  assert.equal(
    set(CONFIG, entry),
    `${CONFIG}\n[mcp_servers.linear]\ncommand = "/bin/linear"\nargs = ["--x"]\n`,
  );
  assert.equal(set("", entry), '[mcp_servers.linear]\ncommand = "/bin/linear"\nargs = ["--x"]\n');
});

test("setTomlServer replaces a table and its subtables in place", () => {
  const text = `${CONFIG.replace("[profiles", '[mcp_servers.linear]\ncommand = "/old"\n\n[mcp_servers.linear.env]\nA = "1"\n\n[profiles')}`;
  const replaced = set(text, { command: "/new", args: [], env: { "A B": 'q"\x7f' } });
  assert.ok(replaced.includes('# Codex settings\nmodel = "gpt-5" # keep this comment\n'));
  assert.ok(
    replaced.includes(
      '[mcp_servers.linear]\ncommand = "/new"\nargs = []\nenv = { "A B" = "q\\"\\u007F" }\n\n[profiles.fast]',
    ),
  );
  assert.deepEqual(parseToml(replaced, "x").mcp_servers, {
    mine: { command: "/bin/mine" },
    linear: { command: "/new", args: [], env: { "A B": 'q"\x7f' } },
  });
});

test("setTomlServer removes a table, and leaves a missing one alone", () => {
  const added = set(CONFIG, entry);
  assert.equal(set(added, undefined), CONFIG);
  assert.equal(set(CONFIG, undefined), CONFIG);
  assert.equal(
    set(CONFIG, undefined, ["mcp_servers", "mine"]),
    CONFIG.replace('[mcp_servers.mine]\ncommand = "/bin/mine"\n\n', ""),
  );
});

test("setTomlServer refuses servers it can't edit as tables, and invalid TOML", () => {
  const dotted = 'mcp_servers.linear.command = "/bin/linear"\n';
  assert.throws(() => set(dotted, entry), /couldn't edit the "linear" server/);
  assert.throws(() => set("model = \n", entry), /config.toml: invalid TOML at line 1/);
});
