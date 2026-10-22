// Installer integration tests: run install.sh against a copied repository and temporary homes.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_SETTINGS = {
  attribution: { commit: "", pr: "", sessionUrl: false },
  env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_FEEDBACK_COMMAND: "1" },
};
const EXPECTED_COPILOT_SETTINGS = { includeCoAuthoredBy: false };
const HOME_NAMES = [
  "HOME",
  "CURSOR_HOME",
  "ZED_HOME",
  "CLAUDE_HOME",
  "COPILOT_HOME",
  "AGENTS_HOME",
] as const;
type HomeName = (typeof HOME_NAMES)[number];

// Find a command on this process's PATH, as a shell would
function which(command: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, command))
    .find((file) => fs.existsSync(file));
}

const BASH = which("bash");
const NODE = which("node");
const skip =
  !BASH || !NODE || !fs.existsSync(path.join(REPO_ROOT, "node_modules"))
    ? "installer tests require bash, node, and npm ci"
    : false;

interface InstallResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Copy only installer inputs into a temporary repository; never touch real application homes
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repository fixture");
  for (const name of [
    "install.sh",
    "settings/claude.json",
    "settings/copilot.json",
    "package.json",
    "package-lock.json",
  ]) {
    fs.cpSync(path.join(REPO_ROOT, name), path.join(repo, name), { preserveTimestamps: true });
  }
  fs.cpSync(path.join(REPO_ROOT, "scripts"), path.join(repo, "scripts"), { recursive: true });
  // Reuse this checkout's installed dependencies rather than running npm ci
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(repo, "node_modules"));

  // Default rules are copied; this machine's other plugins are not
  const plugins = path.join(repo, "plugins");
  const defaults = path.join(plugins, "dotagents-defaults");
  fs.cpSync(
    path.join(REPO_ROOT, "plugins", "dotagents-defaults", "rules"),
    path.join(defaults, "rules"),
    {
      recursive: true,
    },
  );
  const homes = Object.fromEntries(
    HOME_NAMES.map((name) => [name, path.join(root, name.toLowerCase())]),
  ) as Record<HomeName, string>;

  // An allowlisted PATH makes missing-Node tests independent of the host
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const command of ["dirname", "basename", "mkdir", "ln", "grep", "cat", "mv", "node"]) {
    const executable = which(command);
    assert.ok(executable, `required utility: ${command}`);
    fs.symlinkSync(executable, path.join(bin, command));
  }
  const env: Record<string, string> = { ...homes, PATH: bin };

  const f = {
    root,
    repo,
    plugins,
    defaults,
    homes,
    bin,
    env,
    agents: path.join(repo, "AGENTS.md"),
    settings: path.join(homes.CLAUDE_HOME, "settings.json"),
    overlay: path.join(repo, "settings", "claude.json"),
    copilotSettings: path.join(homes.COPILOT_HOME, "settings.json"),
    copilotOverlay: path.join(repo, "settings", "copilot.json"),
    skill: "",
  };
  f.skill = addSkill(f, "dotagents-defaults/test-skill");
  return f;
}

type Fixture = ReturnType<typeof fixture>;

// Run install.sh with the given targets, asserting success or an "error:" failure
function install(
  f: Fixture,
  targets: string[] = [],
  { success = true }: { success?: boolean } = {},
): InstallResult {
  const result = spawnSync(BASH ?? "bash", [path.join(f.repo, "install.sh"), ...targets], {
    cwd: f.root,
    env: f.env,
    encoding: "utf8",
    timeout: 30_000,
  });
  const output = result.stdout + result.stderr;
  if (success) {
    assert.equal(result.status, 0, output);
  } else {
    assert.notEqual(result.status, 0, output);
    assert.match(result.stderr.toLowerCase(), /error:/, output);
  }
  return result;
}

// Record every path under the homes: link targets, file bytes and mtimes, directories, absences
function snapshotHomes(f: Fixture): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const home of Object.values(f.homes)) {
    if (!fs.existsSync(home)) {
      snapshot[home] = "absent";
      continue;
    }
    const paths = [
      home,
      ...fs.readdirSync(home, { recursive: true }).map((name) => path.join(home, String(name))),
    ];
    for (const file of paths.sort()) {
      const stat = fs.lstatSync(file, { bigint: true });
      if (stat.isSymbolicLink()) {
        snapshot[file] = `link ${fs.readlinkSync(file)}`;
      } else if (stat.isFile()) {
        snapshot[file] = `file ${fs.readFileSync(file).toString("base64")} ${stat.mtimeNs}`;
      } else {
        snapshot[file] = "directory";
      }
    }
  }
  return snapshot;
}

// A preflight failure must not create adapters, links, backups, or homes
function assertPreflightFailure(f: Fixture, targets: string[] = []): InstallResult {
  const before = snapshotHomes(f);
  const result = install(f, targets, { success: false });
  assert.deepEqual(
    snapshotHomes(f),
    before,
    "preflight must not create adapters, links, backups, or homes",
  );
  return result;
}

function assertLink(file: string, source: string) {
  assert.ok(fs.lstatSync(file).isSymbolicLink(), file);
  assert.equal(fs.realpathSync(file), fs.realpathSync(source));
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

// Assert the selected integrations are installed and unselected homes are untouched
function assertInstalled(f: Fixture, targets: string[]) {
  const adapter = path.join(f.homes.CURSOR_HOME, "rules", "dotagents.mdc");
  if (targets.includes("cursor")) {
    assert.ok(!fs.lstatSync(adapter).isSymbolicLink());
    assert.equal(
      fs.readFileSync(adapter, "utf8"),
      "---\ndescription: Personal instructions shared across coding agents\nalwaysApply: true\n---\n\n" +
        "# Generated by dotagents\n\n" +
        fs.readFileSync(f.agents, "utf8"),
    );
  } else {
    assert.ok(!fs.existsSync(f.homes.CURSOR_HOME));
  }

  // Zed links instructions; Cursor, Zed, and Copilot share the open skills folder
  if (targets.includes("zed")) {
    assertLink(path.join(f.homes.ZED_HOME, "AGENTS.md"), f.agents);
  } else {
    assert.ok(!fs.existsSync(f.homes.ZED_HOME));
  }
  if (targets.some((target) => ["cursor", "zed", "copilot"].includes(target))) {
    assertLink(path.join(f.homes.AGENTS_HOME, "skills", "test-skill"), f.skill);
  } else {
    assert.ok(!fs.existsSync(f.homes.AGENTS_HOME));
  }

  // Claude and Copilot get instructions, skills, and their settings overlays
  if (targets.includes("claude")) {
    assertLink(path.join(f.homes.CLAUDE_HOME, "CLAUDE.md"), f.agents);
    assertLink(path.join(f.homes.CLAUDE_HOME, "skills", "test-skill"), f.skill);
    assert.ok(!fs.lstatSync(f.settings).isSymbolicLink());
    assert.deepEqual(readJson(f.settings), EXPECTED_SETTINGS);
  } else {
    assert.ok(!fs.existsSync(f.homes.CLAUDE_HOME));
  }
  if (targets.includes("copilot")) {
    assertLink(path.join(f.homes.COPILOT_HOME, "copilot-instructions.md"), f.agents);
    assert.ok(!fs.lstatSync(f.copilotSettings).isSymbolicLink());
    assert.deepEqual(readJson(f.copilotSettings), EXPECTED_COPILOT_SETTINGS);
  } else {
    assert.ok(!fs.existsSync(f.homes.COPILOT_HOME));
  }
  assert.ok(!fs.existsSync(f.homes.HOME), "all home overrides must be honored");
}

const backupsOf = (file: string) =>
  fs.existsSync(path.dirname(file))
    ? fs
        .readdirSync(path.dirname(file))
        .filter((name) => name.startsWith(`${path.basename(file)}.`) && name.endsWith(".bak"))
    : [];

// Plugin content helpers: spec is "plugin/name"
function pluginPath(f: Pick<Fixture, "plugins">, spec: string, kind: string) {
  const [plugin = "", name = ""] = spec.split("/");
  return path.join(f.plugins, plugin, kind, name);
}
function addRule(f: Fixture, spec: string, text: string) {
  const rule = pluginPath(f, spec, "rules");
  fs.mkdirSync(path.dirname(rule), { recursive: true });
  fs.writeFileSync(rule, text);
  return rule;
}
function addSkill(f: Pick<Fixture, "plugins">, spec: string) {
  const skill = pluginPath(f, spec, "skills");
  const name = path.basename(skill);
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, "SKILL.md"),
    `---\nname: ${name}\ndescription: Installer fixture\n---\nTest skill.\n`,
  );
  return skill;
}
function addScript(f: Fixture, spec: string, executable = true) {
  const script = pluginPath(f, spec, "scripts");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, `#!/bin/sh\necho ${path.basename(script)}\n`);
  fs.chmodSync(script, executable ? 0o755 : 0o644);
  return script;
}

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
    assert.deepEqual(readJson(f.copilotSettings), { includeCoAuthoredBy: false, theme: "dark" });
    assert.equal(backupsOf(f.copilotSettings).length, 1);
  });

  await t.test("cursor only needs no valid overlays", (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.overlay, "not JSON");
    fs.writeFileSync(f.copilotOverlay, "not JSON");
    install(f, ["cursor"]);
    assertInstalled(f, ["cursor"]);
  });

  await t.test("zed only needs no overlays", (t) => {
    const f = fixture(t);
    fs.rmSync(f.overlay);
    fs.rmSync(f.copilotOverlay);
    install(f, ["zed"]);
    assertInstalled(f, ["zed"]);
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
    fs.rmSync(f.overlay);
    assertPreflightFailure(f);
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
    fs.rmSync(f.copilotOverlay);
    assertPreflightFailure(f, ["copilot"]);
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

  await t.test("AGENTS.md joins default rules, then plugin rules in order", (t) => {
    // Defaults load first even when another plugin sorts before them
    const f = fixture(t);
    addRule(f, "zeta/a.md", "## Zeta A\n");
    addRule(f, "alpha/b.md", "## Alpha B\n");
    addRule(f, "alpha/a.md", "## Alpha A\n");
    addRule(f, "alpha/notes.txt", "Ignored.\n");
    fs.mkdirSync(path.join(f.plugins, "empty"));
    install(f, ["zed"]);
    const defaults = fs
      .readdirSync(path.join(f.defaults, "rules"))
      .filter((name) => name.endsWith(".md"))
      .sort();
    assert.ok(defaults.length > 0);
    const parts = defaults.map((name) =>
      fs.readFileSync(path.join(f.defaults, "rules", name), "utf8"),
    );
    parts.push("## Alpha A\n", "## Alpha B\n", "## Zeta A\n");
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

  await t.test("missing default rules fail before installing", (t) => {
    const f = fixture(t);
    fs.rmSync(path.join(f.defaults, "rules"), { recursive: true });
    addRule(f, "alpha/a.md", "## Alpha A\n");
    assertPreflightFailure(f, ["zed"]);
    assert.ok(!fs.existsSync(f.agents));
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
