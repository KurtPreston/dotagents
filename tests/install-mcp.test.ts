// Installer integration tests for plugin MCP servers.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertPreflightFailure,
  fixture,
  install,
  pluginPath,
  readJson,
  skip,
} from "./support/installer.ts";

// MCP fixture: a command on the allowlisted PATH, and each agent's MCP config location
function mcpFixture(t: TestContext) {
  const f = fixture(t);
  const tool = path.join(f.bin, "tool");
  fs.writeFileSync(tool, "#!/bin/sh\n", { mode: 0o755 });
  const configs: Record<string, [string, string]> = {
    zed: [path.join(f.homes.ZED_HOME, "settings.json"), "context_servers"],
    copilot: [path.join(f.homes.COPILOT_HOME, "mcp-config.json"), "mcpServers"],
    claude: [path.join(f.homes.HOME, ".claude.json"), "mcpServers"],
    cursor: [path.join(f.homes.CURSOR_HOME, "mcp.json"), "mcpServers"],
  };

  // Declare a server as "plugin/name", and read a target's installed servers
  const addMcp = (spec: string, declaration: object) => {
    const file = `${pluginPath(f, spec, "mcp")}.json`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(declaration));
    return file;
  };
  const servers = (target: string): Record<string, Record<string, unknown>> => {
    const [file = "", key = ""] = configs[target] ?? [];
    return (readJson(file) as Record<string, Record<string, Record<string, unknown>>>)[key] ?? {};
  };
  return { ...f, f, tool, configs, addMcp, servers };
}

test("installer MCP servers", { skip }, async (t) => {
  await t.test("servers reach every agent", (t) => {
    const m = mcpFixture(t);
    m.addMcp("alpha/tool", { command: "tool", args: ["--serve"] });
    const result = install(m.f);
    for (const target of Object.keys(m.configs)) {
      const server = m.servers(target).tool;
      assert.equal(server?.command, m.tool, target);
      assert.deepEqual(server?.args, ["--serve"], target);
    }
    assert.deepEqual(m.servers("copilot").tool?.tools, ["*"]);
    assert.equal(m.servers("claude").tool?.type, "stdio");
    assert.match(result.stdout, /validated/);

    // Rerunning leaves every MCP config and the state file untouched
    const files = [
      ...Object.values(m.configs).map(([file]) => file),
      path.join(m.homes.AGENTS_HOME, "state", "mcp.json"),
    ];
    const stamp = () =>
      files.map((file) => [
        fs.readFileSync(file, "utf8"),
        fs.statSync(file, { bigint: true }).mtimeNs,
      ]);
    const before = stamp();
    const rerun = install(m.f);
    assert.deepEqual(stamp(), before);
    assert.doesNotMatch(rerun.stdout, /backup/);
  });

  await t.test("on-demand servers are not installed", (t) => {
    const m = mcpFixture(t);
    m.addMcp("alpha/tool", { command: "tool", tools: ["read"] });
    m.addMcp("alpha/lazy", { command: "tool", load: "on-demand" });
    install(m.f);

    // Only the static server reaches each agent, with its allowlist on Copilot
    for (const target of Object.keys(m.configs)) {
      assert.ok(m.servers(target).tool, target);
      assert.ok(!m.servers(target).lazy, target);
    }
    assert.deepEqual(m.servers("copilot").tool?.tools, ["read"]);
    const state = fs.readFileSync(path.join(m.homes.AGENTS_HOME, "state", "mcp.json"), "utf8");
    assert.doesNotMatch(state, /lazy/);
  });

  await t.test("only selected targets get servers", (t) => {
    const m = mcpFixture(t);
    m.addMcp("alpha/tool", { command: "tool" });
    install(m.f, ["cursor"]);
    assert.ok(m.servers("cursor").tool);
    for (const target of ["zed", "copilot", "claude"]) {
      assert.ok(!fs.existsSync(m.configs[target]?.[0] ?? ""), target);
    }
  });

  await t.test("removed declarations are pruned", (t) => {
    const m = mcpFixture(t);
    const kept = m.addMcp("alpha/kept", { command: "tool" });
    const dropped = m.addMcp("alpha/dropped", { command: "tool" });
    install(m.f, ["zed", "cursor"]);
    fs.rmSync(dropped);
    install(m.f, ["zed", "cursor"]);
    for (const target of ["zed", "cursor"]) {
      assert.deepEqual(Object.keys(m.servers(target)), ["kept"]);
    }

    // Removing the last declaration still prunes, using the recorded state
    fs.rmSync(kept);
    install(m.f, ["zed", "cursor"]);
    for (const target of ["zed", "cursor"]) {
      assert.deepEqual(m.servers(target), {});
    }
  });

  await t.test("an unmanaged conflict fails before installing", (t) => {
    const m = mcpFixture(t);
    m.addMcp("alpha/tool", { command: "tool" });
    const [file = ""] = m.configs.cursor ?? [];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"mcpServers": {"tool": {"command": "/elsewhere"}}}');
    const result = assertPreflightFailure(m.f);
    assert.match(result.stderr, /didn't install/);
    assert.ok(!fs.existsSync(m.agents));
  });

  await t.test("an unresolvable command fails before installing", (t) => {
    const m = mcpFixture(t);
    m.addMcp("alpha/tool", { command: "absent" });
    const result = assertPreflightFailure(m.f);
    assert.match(result.stderr, /command "absent" was not found on PATH/);
  });

  await t.test("duplicate server names fail before installing", (t) => {
    const m = mcpFixture(t);
    m.addMcp("alpha/tool", { command: "tool" });
    m.addMcp("zeta/tool", { command: "tool" });
    const result = assertPreflightFailure(m.f);
    for (const text of ["'tool'", "plugins/alpha", "plugins/zeta"]) {
      assert.ok(result.stderr.includes(text));
    }
  });

  await t.test("no declarations or state records no MCP state", (t) => {
    const m = mcpFixture(t);
    install(m.f);
    assert.ok(!fs.existsSync(path.join(m.homes.AGENTS_HOME, "state")));
    assert.ok(!fs.existsSync(path.join(m.homes.HOME, ".claude.json")));
  });
});
