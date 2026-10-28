// Installer integration tests: run install.sh against a copied repository and temporary homes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  BASH,
  EXPECTED_COPILOT_SETTINGS,
  EXPECTED_SETTINGS,
  addRule,
  addScript,
  addSkill,
  assertInstalled,
  assertLink,
  assertPreflightFailure,
  backupsOf,
  fixture,
  install,
  readJson,
  skip,
} from "./support/installer.ts";

test("installer", { skip }, async (t) => {
  await t.test("default installs all integrations", (t) => {
    const f = fixture(t);
    install(f);
    assertInstalled(f, ["cursor", "zed", "claude", "copilot"]);
    assert.deepEqual(backupsOf(f.settings), []);
    assert.deepEqual(backupsOf(f.copilotSettings), []);
  });

  await t.test("claude only installs instructions, skills, and settings", (t) => {
    const f = fixture(t);
    install(f, ["claude"]);
    assertInstalled(f, ["claude"]);
  });

  await t.test("copilot only installs instructions, skills, and settings", (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.overlay, "not JSON");
    install(f, ["copilot"]);
    assertInstalled(f, ["copilot"]);
  });

  await t.test("runner install uses RUNNER_TEMP and exports homes", (t) => {
    const f = fixture(t);
    const runnerTemp = path.join(f.root, "runner temp");
    const githubEnv = path.join(f.root, "github env");
    const env = Object.fromEntries(Object.entries(f.env).filter(([key]) => !key.endsWith("_HOME")));
    const result = spawnSync(BASH ?? "bash", [path.join(f.repo, "install.sh"), "--runner"], {
      cwd: f.root,
      env: { ...env, RUNNER_TEMP: runnerTemp, GITHUB_ENV: githubEnv },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);

    // Copilot alone is installed under RUNNER_TEMP, and every home is exported
    const copilot = path.join(runnerTemp, "dotagents", "copilot");
    assertLink(path.join(copilot, "copilot-instructions.md"), f.agents);
    assert.ok(!fs.existsSync(path.join(runnerTemp, "dotagents", "claude")));
    const exported = Object.fromEntries(
      fs
        .readFileSync(githubEnv, "utf8")
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    assert.equal(exported.COPILOT_HOME, copilot);
    assert.deepEqual(Object.keys(exported).sort(), [
      "AGENTS_HOME",
      "CLAUDE_HOME",
      "COPILOT_HOME",
      "CURSOR_HOME",
      "ZED_HOME",
    ]);
    assert.ok(!fs.existsSync(f.homes.HOME));
  });

  await t.test("copilot keeps local settings", (t) => {
    // Copilot owns most of its settings; only the declared key is enforced
    const f = fixture(t);
    fs.mkdirSync(path.dirname(f.copilotSettings));
    fs.writeFileSync(f.copilotSettings, '{"includeCoAuthoredBy": true, "theme": "dark"}\n');
    install(f, ["copilot"]);
    assert.deepEqual(readJson(f.copilotSettings), { ...EXPECTED_COPILOT_SETTINGS, theme: "dark" });
    assert.equal(backupsOf(f.copilotSettings).length, 1);
  });

  await t.test("cursor only needs no valid overlays", (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.overlay, "not JSON");
    fs.writeFileSync(f.copilotOverlay, "not JSON");
    install(f, ["cursor"]);
    assertInstalled(f, ["cursor"]);
  });

  await t.test("zed only needs its own overlay and preserves JSONC settings", (t) => {
    const f = fixture(t);
    fs.rmSync(f.overlay);
    fs.rmSync(f.copilotOverlay);
    // Keep local comments, trailing commas, and nested settings through installation
    const settings = path.join(f.homes.ZED_HOME, "settings.json");
    fs.mkdirSync(f.homes.ZED_HOME, { recursive: true });
    fs.writeFileSync(
      settings,
      '{\n  // Local preferences\n  "agent": {"dock": "left", "button": false,},\n}\n',
    );
    install(f, ["zed"]);
    assertInstalled(f, ["zed"]);
    const text = fs.readFileSync(settings, "utf8");
    assert.match(text, /\/\/ Local preferences/);
    assert.match(text, /"button": false/);
    assert.match(text, /"dock": "right"/);
    assert.match(text, /"show_sign_in": false/);
    const before = fs.readFileSync(settings);
    install(f, ["zed"]);
    assert.deepEqual(fs.readFileSync(settings), before);
  });

  await t.test("cursor and zed leave invalid Claude settings untouched", (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.dirname(f.settings));
    fs.writeFileSync(f.settings, "invalid local settings\n");
    fs.writeFileSync(f.overlay, "invalid overlay\n");
    const before = fs.statSync(f.settings, { bigint: true }).mtimeNs;
    install(f, ["cursor", "zed"]);
    assert.equal(fs.readFileSync(f.settings, "utf8"), "invalid local settings\n");
    assert.equal(fs.statSync(f.settings, { bigint: true }).mtimeNs, before);
    assert.deepEqual(fs.readdirSync(path.dirname(f.settings)), ["settings.json"]);
    assertLink(path.join(f.homes.ZED_HOME, "AGENTS.md"), f.agents);
    assertLink(path.join(f.homes.AGENTS_HOME, "skills", "test-skill"), f.skill);
    assert.ok(fs.statSync(path.join(f.homes.CURSOR_HOME, "rules", "dotagents.mdc")).isFile());
  });

  await t.test("a rerun keeps local nested values, bytes, and backups", (t) => {
    // The first install replaces declared fields but backs up the exact local bytes
    const f = fixture(t);
    const original =
      '{ "attribution": {"commit": "local", "pr": "local", "sessionUrl": true, "local": {"enabled": true}}, ' +
      '"permissions": {"allow": ["Read"], "local": {"mode": "ask"}} }\n';
    fs.mkdirSync(path.dirname(f.settings));
    fs.writeFileSync(f.settings, original);
    install(f);
    assert.deepEqual(readJson(f.settings), {
      attribution: { ...EXPECTED_SETTINGS.attribution, local: { enabled: true } },
      env: EXPECTED_SETTINGS.env,
      permissions: { allow: ["Read"], local: { mode: "ask" } },
    });
    const backups = backupsOf(f.settings);
    assert.equal(backups.length, 1);
    const backup = path.join(path.dirname(f.settings), backups[0] ?? "");
    assert.equal(fs.readFileSync(backup, "utf8"), original);

    // Repeating the full install changes nothing in the settings folder
    const contents = fs.readFileSync(f.settings);
    const before = fs.statSync(f.settings, { bigint: true });
    const entries = fs.readdirSync(path.dirname(f.settings)).sort();
    const result = install(f);
    assert.match(result.stdout, new RegExp(`unchanged ${f.settings}`));
    assert.deepEqual(fs.readFileSync(f.settings), contents);
    const after = fs.statSync(f.settings, { bigint: true });
    assert.deepEqual([after.mtimeNs, after.ino], [before.mtimeNs, before.ino]);
    assert.deepEqual(fs.readdirSync(path.dirname(f.settings)).sort(), entries);
    assert.equal(fs.readFileSync(backup, "utf8"), original);
  });

  await t.test("every target is validated before installing", (t) => {
    const f = fixture(t);
    for (const targets of [
      ["unknown"],
      ["cursor", "unknown"],
      ["zed", "claude", "unknown"],
      ["claude", "cursor", "unknown"],
    ]) {
      const result = assertPreflightFailure(f, targets);
      assert.match(result.stderr, /unknown target/);
    }
  });

  await t.test("missing Node fails before any selected integration", (t) => {
    const f = fixture(t);
    fs.rmSync(path.join(f.bin, "node"));
    for (const targets of [
      [],
      ["cursor"],
      ["zed"],
      ["claude"],
      ["copilot"],
      ["cursor", "zed", "claude"],
      ["cursor", "copilot"],
    ]) {
      const result = assertPreflightFailure(f, targets);
      assert.match(result.stderr.toLowerCase(), /node 22\.18/);
      assert.match(result.stderr.toLowerCase(), /require|install|not found|missing/);
    }
  });

  await t.test("an older Node fails before installing", (t) => {
    const f = fixture(t);
    fs.rmSync(path.join(f.bin, "node"));
    fs.writeFileSync(path.join(f.bin, "node"), "#!/bin/sh\necho 22.17.0\n", { mode: 0o755 });
    const result = assertPreflightFailure(f);
    assert.match(result.stderr, /Node 22\.18 or later \(found 22\.17\.0\)/);
  });

  await t.test("stale dependencies without npm fail before installing", (t) => {
    const f = fixture(t);
    fs.rmSync(path.join(f.repo, "node_modules"));
    const result = assertPreflightFailure(f);
    assert.match(result.stderr, /npm is needed/);
    assert.ok(!fs.existsSync(f.agents));
  });

  await t.test("invalid destination JSON fails before adapters or links", (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.dirname(f.settings));
    for (const raw of [
      "",
      "{",
      "[]",
      '{"a": 1, "a": 2}',
      '{"value": NaN}',
      '{"attribution": "local"}',
    ]) {
      fs.writeFileSync(f.settings, raw);
      assertPreflightFailure(f);
    }
  });

  await t.test("an invalid overlay fails before adapters or links", (t) => {
    const f = fixture(t);
    for (const raw of ["", "{", "null", '{"a": 1, "a": 2}', '{"value": Infinity}']) {
      fs.writeFileSync(f.overlay, raw);
      assertPreflightFailure(f);
    }

    // Without any overlay, Claude's settings are left alone
    fs.rmSync(f.overlay);
    install(f, ["claude"]);
    assert.ok(!fs.existsSync(f.settings));
  });

  await t.test("overlays from several plugins merge in plugin order", (t) => {
    const f = fixture(t);
    const extra = path.join(f.plugins, "zeta", "settings", "claude.json");
    fs.mkdirSync(path.dirname(extra), { recursive: true });
    fs.writeFileSync(extra, JSON.stringify({ attribution: { pr: "" }, theme: "dark" }));
    install(f, ["claude"]);
    assert.deepEqual(readJson(f.settings), { ...EXPECTED_SETTINGS, theme: "dark" });

    // The same key set to a different value fails, naming both files
    fs.writeFileSync(extra, JSON.stringify({ attribution: { pr: "mine" } }));
    const result = assertPreflightFailure(f, ["claude"]);
    assert.match(result.stderr, /zeta\/settings\/claude\.json sets \$\["attribution"\]\["pr"\]/);
    assert.match(result.stderr, /fixture\/settings\/claude\.json/);
  });

  await t.test("the engine's mcp-call is linked into the agents bin folder", (t) => {
    const f = fixture(t);
    install(f, ["copilot"]);
    assertLink(
      path.join(f.homes.AGENTS_HOME, "bin", "mcp-call"),
      path.join(f.repo, "bin", "mcp-call"),
    );

    // A plugin can't take the engine's script name
    addScript(f, "alpha/mcp-call");
    const result = assertPreflightFailure(f, ["copilot"]);
    assert.match(result.stderr, /'mcp-call' in plugins\/alpha is reserved/);
  });

  await t.test("invalid Copilot settings fail before any integration", (t) => {
    // Copilot is checked after Claude, so Claude must not be applied first
    const f = fixture(t);
    fs.mkdirSync(path.dirname(f.copilotSettings));
    for (const raw of ["", "{", "[]", "// comment\n{}", '{"a": 1, "a": 2}']) {
      fs.writeFileSync(f.copilotSettings, raw);
      assertPreflightFailure(f);
      assertPreflightFailure(f, ["copilot"]);
    }
    fs.rmSync(f.copilotSettings);

    // A broken repository overlay also stops installation up front
    fs.writeFileSync(f.copilotOverlay, "{");
    assertPreflightFailure(f);
  });

  await t.test("a settings directory is rejected before installing", (t) => {
    const f = fixture(t);
    fs.mkdirSync(f.settings, { recursive: true });
    assertPreflightFailure(f);
  });

  await t.test("settings symlinks are rejected without touching their targets", (t) => {
    const f = fixture(t);
    fs.mkdirSync(path.dirname(f.settings));
    const referent = path.join(f.root, "local-settings.json");
    for (const dangling of [false, true]) {
      if (!dangling) {
        fs.writeFileSync(referent, '{"local": "keep"}\n');
      }
      fs.symlinkSync(referent, f.settings);
      const result = assertPreflightFailure(f);
      assert.match(result.stderr.toLowerCase(), /symlink/);
      assert.equal(fs.readlinkSync(f.settings), referent);
      assert.equal(fs.existsSync(referent), !dangling);
      if (!dangling) {
        assert.equal(fs.readFileSync(referent, "utf8"), '{"local": "keep"}\n');
        fs.rmSync(referent);
      }
      fs.rmSync(f.settings);
    }
  });

  await t.test("user-managed instruction files fail the install before any change", (t) => {
    const f = fixture(t);
    const files: [string, string][] = [
      ["cursor", path.join(f.homes.CURSOR_HOME, "rules", "dotagents.mdc")],
      ["zed", path.join(f.homes.ZED_HOME, "AGENTS.md")],
      ["claude", path.join(f.homes.CLAUDE_HOME, "CLAUDE.md")],
      ["copilot", path.join(f.homes.COPILOT_HOME, "copilot-instructions.md")],
    ];
    for (const [target, file] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "User-managed instructions.\n");
      for (const targets of [[target], []]) {
        const result = assertPreflightFailure(f, targets);
        assert.ok(result.stderr.includes(file), result.stderr);
        assert.ok(!fs.existsSync(f.agents));
      }
      fs.rmSync(file);
    }
  });

  await t.test("AGENTS.md joins _ rules, then default rules, then plugin rules in order", (t) => {
    // Defaults load first even when another plugin sorts before them; _ rules lead them all
    const f = fixture(t);
    addRule(f, "zeta/a.md", "## Zeta A\n");
    addRule(f, "alpha/b.md", "## Alpha B\n");
    addRule(f, "alpha/a.md", "## Alpha A\n");
    addRule(f, "alpha/_introduction.md", "# Alpha\n");
    addRule(f, "alpha/notes.txt", "Ignored.\n");
    fs.mkdirSync(path.join(f.plugins, "empty"));
    install(f, ["zed"]);
    const defaults = fs
      .readdirSync(path.join(f.defaults, "rules"))
      .filter((name) => name.endsWith(".md"))
      .sort();
    const parts = [
      "# Alpha\n",
      ...defaults.map((name) => fs.readFileSync(path.join(f.defaults, "rules", name), "utf8")),
      "## Alpha A\n",
      "## Alpha B\n",
      "## Zeta A\n",
    ];
    const generated = fs.readFileSync(f.agents, "utf8");
    const split = generated.indexOf("\n\n");
    assert.match(generated.slice(0, split), /Generated by install.sh/);
    assert.equal(generated.slice(split + 2), parts.join("\n"));
    assertInstalled(f, ["zed"]);

    // Reinstalling picks up edited rules and drops removed ones
    fs.rmSync(path.join(f.plugins, "alpha", "rules", "a.md"));
    install(f, ["zed"]);
    assert.doesNotMatch(fs.readFileSync(f.agents, "utf8"), /## Alpha A/);
    assert.match(fs.readFileSync(f.agents, "utf8"), /## Alpha B/);
  });

  await t.test("a hand-written AGENTS.md is not overwritten", (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.agents, "Hand-written instructions.\n");
    const result = assertPreflightFailure(f, ["zed"]);
    assert.ok(result.stderr.includes(f.agents));
    assert.equal(fs.readFileSync(f.agents, "utf8"), "Hand-written instructions.\n");
  });

  await t.test("an older generated marker is replaced", (t) => {
    // Any install.sh marker counts as generated, so marker wording can change
    const f = fixture(t);
    fs.writeFileSync(f.agents, "<!-- Generated by install.sh from rules/. -->\n\nOld.\n");
    install(f, ["zed"]);
    assert.doesNotMatch(fs.readFileSync(f.agents, "utf8"), /Old\./);
  });

  await t.test("no rules in any plugin fail before installing", (t) => {
    const f = fixture(t);
    fs.rmSync(path.join(f.defaults, "rules"), { recursive: true });
    assertPreflightFailure(f, ["zed"]);
    assert.ok(!fs.existsSync(f.agents));

    // Rules from any plugin are enough
    addRule(f, "alpha/a.md", "## Alpha A\n");
    install(f, ["zed"]);
  });

  await t.test("user-managed skill folders fail the install before any change", (t) => {
    const f = fixture(t);
    for (const [target, home] of [
      ["cursor", "AGENTS_HOME"],
      ["claude", "CLAUDE_HOME"],
      ["copilot", "AGENTS_HOME"],
    ] as const) {
      const skill = path.join(f.homes[home], "skills", "test-skill");
      fs.mkdirSync(skill, { recursive: true });
      fs.writeFileSync(path.join(skill, "SKILL.md"), "Local skill.\n");
      const result = assertPreflightFailure(f, [target]);
      assert.ok(result.stderr.includes(skill));
      assert.ok(!fs.existsSync(f.agents));
      fs.rmSync(f.homes[home], { recursive: true });
    }
  });

  await t.test("plugin skills are linked beside default skills", (t) => {
    const f = fixture(t);
    const alpha = addSkill(f, "alpha/alpha-skill");
    const zeta = addSkill(f, "zeta/zeta-skill");
    install(f);
    assertInstalled(f, ["cursor", "zed", "claude", "copilot"]);
    for (const home of ["AGENTS_HOME", "CLAUDE_HOME"] as const) {
      assertLink(path.join(f.homes[home], "skills", "alpha-skill"), alpha);
      assertLink(path.join(f.homes[home], "skills", "zeta-skill"), zeta);
    }
  });

  await t.test("duplicate skill names fail before installing", (t) => {
    // A plugin may not reuse a default skill's name, or another plugin's
    const f = fixture(t);
    for (const [plugins, name] of [
      [["dotagents-defaults", "alpha"], "test-skill"],
      [["alpha", "zeta"], "shared-skill"],
    ] as const) {
      const added = plugins
        .filter((plugin) => plugin !== "dotagents-defaults")
        .map((plugin) => addSkill(f, `${plugin}/${name}`));
      const result = assertPreflightFailure(f);
      assert.ok(result.stderr.includes(name));
      for (const plugin of plugins) {
        assert.ok(result.stderr.includes(`plugins/${plugin}`));
      }
      assert.ok(!fs.existsSync(f.agents));
      added.forEach((skill) => fs.rmSync(skill, { recursive: true }));
    }
  });

  await t.test("plugin scripts are linked into the agents bin folder", (t) => {
    // Every target links scripts; non-executable files are skipped
    const f = fixture(t);
    const alpha = addScript(f, "alpha/alpha-tool");
    const zeta = addScript(f, "zeta/zeta-tool");
    addScript(f, "zeta/README.md", false);
    for (const targets of [["claude"], []]) {
      install(f, targets);
      const binDir = path.join(f.homes.AGENTS_HOME, "bin");
      assertLink(path.join(binDir, "alpha-tool"), alpha);
      assertLink(path.join(binDir, "zeta-tool"), zeta);
      assert.ok(!fs.existsSync(path.join(binDir, "README.md")));
    }
  });

  await t.test("links to skills and scripts plugins dropped are removed", (t) => {
    // Dangling links into the checkout go; dangling links made elsewhere stay
    const f = fixture(t);
    const skill = addSkill(f, "alpha/alpha-skill");
    const script = addScript(f, "alpha/alpha-tool");
    install(f);
    fs.rmSync(path.join(f.plugins, "alpha"), { recursive: true });
    const foreign = path.join(f.homes.AGENTS_HOME, "bin", "foreign-tool");
    fs.symlinkSync(path.join(f.root, "missing"), foreign);
    install(f);
    for (const home of ["AGENTS_HOME", "CLAUDE_HOME"] as const) {
      assert.ok(
        !fs.lstatSync(path.join(f.homes[home], "skills", path.basename(skill)), {
          throwIfNoEntry: false,
        }),
      );
    }
    const binDir = path.join(f.homes.AGENTS_HOME, "bin");
    assert.ok(!fs.lstatSync(path.join(binDir, path.basename(script)), { throwIfNoEntry: false }));
    assert.ok(fs.lstatSync(foreign).isSymbolicLink());
    assertInstalled(f, ["cursor", "zed", "claude", "copilot"]);
  });

  await t.test("user-managed scripts fail the install before any change", (t) => {
    const f = fixture(t);
    addScript(f, "alpha/alpha-tool");
    const local = path.join(f.homes.AGENTS_HOME, "bin", "alpha-tool");
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, "local tool\n");
    const result = assertPreflightFailure(f, ["zed"]);
    assert.ok(result.stderr.includes(local));
    assert.ok(!fs.existsSync(f.agents));
  });

  await t.test("duplicate script names fail before installing", (t) => {
    const f = fixture(t);
    addScript(f, "alpha/shared-tool");
    addScript(f, "zeta/shared-tool");
    const result = assertPreflightFailure(f);
    for (const text of ["shared-tool", "plugins/alpha", "plugins/zeta"]) {
      assert.ok(result.stderr.includes(text));
    }
    assert.ok(!fs.existsSync(f.agents));
  });
});
