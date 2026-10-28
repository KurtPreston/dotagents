// Shared installer test fixture: a copied repository, temporary homes, and assertions.
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXPECTED_SETTINGS = {
  attribution: { commit: "", pr: "", sessionUrl: false },
  env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", DISABLE_FEEDBACK_COMMAND: "1" },
};
export const EXPECTED_COPILOT_SETTINGS = {
  includeCoAuthoredBy: false,
  defaultPermissionMode: "allow-all",
};
export const ZED_OVERLAY = { agent: { dock: "right" }, title_bar: { show_sign_in: false } };
export const HOME_NAMES = [
  "HOME",
  "CURSOR_HOME",
  "ZED_HOME",
  "CLAUDE_HOME",
  "COPILOT_HOME",
  "AGENTS_HOME",
] as const;
export type HomeName = (typeof HOME_NAMES)[number];
export const AGENT_COMMANDS = ["cursor", "zed", "claude", "copilot"] as const;

// Find a command on this process's PATH, as a shell would
export function which(command: string): string | undefined {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, command))
    .find((file) => fs.existsSync(file));
}

export const BASH = which("bash");
export const NODE = which("node");
export const skip =
  !BASH || !NODE || !fs.existsSync(path.join(REPO_ROOT, "node_modules"))
    ? "installer tests require bash, node, and npm ci"
    : false;

export interface InstallResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Copy only installer inputs into a temporary repository; never touch real application homes
export function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repository fixture");
  for (const name of ["install.sh", "package.json", "package-lock.json"]) {
    fs.cpSync(path.join(REPO_ROOT, name), path.join(repo, name), { preserveTimestamps: true });
  }
  for (const dir of ["scripts", "bin"]) {
    fs.cpSync(path.join(REPO_ROOT, dir), path.join(repo, dir), { recursive: true });
  }
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
  // A fixture plugin supplies each agent's settings overlay
  const overlays = path.join(plugins, "fixture", "settings");
  fs.mkdirSync(overlays, { recursive: true });
  for (const [name, overlay] of Object.entries({
    claude: EXPECTED_SETTINGS,
    copilot: EXPECTED_COPILOT_SETTINGS,
    zed: ZED_OVERLAY,
  })) {
    fs.writeFileSync(path.join(overlays, `${name}.json`), JSON.stringify(overlay));
  }
  const homes = Object.fromEntries(
    HOME_NAMES.map((name) => [name, path.join(root, name.toLowerCase())]),
  ) as Record<HomeName, string>;

  // An allowlisted PATH makes missing-Node tests independent of the host
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const command of [
    "dirname",
    "basename",
    "mkdir",
    "ln",
    "grep",
    "cat",
    "mv",
    "node",
    "git",
  ]) {
    const executable = which(command);
    assert.ok(executable, `required utility: ${command}`);
    fs.symlinkSync(executable, path.join(bin, command));
  }
  // Stub agent commands so defaults detect every agent; app bundles come from an empty folder
  for (const agent of AGENT_COMMANDS) {
    fs.writeFileSync(path.join(bin, agent), "#!/bin/sh\n", { mode: 0o755 });
  }
  const apps = path.join(root, "applications");
  fs.mkdirSync(apps);
  const env: Record<string, string> = { ...homes, PATH: bin, DOTAGENTS_APP_DIRS: apps };

  const f = {
    root,
    repo,
    plugins,
    defaults,
    homes,
    bin,
    apps,
    env,
    agents: path.join(repo, "AGENTS.md"),
    settings: path.join(homes.CLAUDE_HOME, "settings.json"),
    overlay: path.join(overlays, "claude.json"),
    copilotSettings: path.join(homes.COPILOT_HOME, "settings.json"),
    copilotOverlay: path.join(overlays, "copilot.json"),
    skill: "",
  };
  f.skill = addSkill(f, "dotagents-defaults/test-skill");
  return f;
}

export type Fixture = ReturnType<typeof fixture>;

// Run install.sh with the given targets, asserting success or an "error:" failure
export function install(
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
export function snapshotHomes(f: Fixture): Record<string, string> {
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
export function assertPreflightFailure(f: Fixture, targets: string[] = []): InstallResult {
  const before = snapshotHomes(f);
  const result = install(f, targets, { success: false });
  assert.deepEqual(
    snapshotHomes(f),
    before,
    "preflight must not create adapters, links, backups, or homes",
  );
  return result;
}

export function assertLink(file: string, source: string) {
  assert.ok(fs.lstatSync(file).isSymbolicLink(), file);
  assert.equal(fs.realpathSync(file), fs.realpathSync(source));
}

export const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

// Assert the selected integrations are installed and unselected homes are untouched
export function assertInstalled(f: Fixture, targets: string[]) {
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
    assert.ok(!fs.existsSync(path.join(f.homes.AGENTS_HOME, "skills")));
  }
  assertLink(
    path.join(f.homes.AGENTS_HOME, "bin", "mcp-call"),
    path.join(f.repo, "bin", "mcp-call"),
  );

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

export const backupsOf = (file: string) =>
  fs.existsSync(path.dirname(file))
    ? fs
        .readdirSync(path.dirname(file))
        .filter((name) => name.startsWith(`${path.basename(file)}.`) && name.endsWith(".bak"))
    : [];

// Plugin content helpers: spec is "plugin/name"
export function pluginPath(f: Pick<Fixture, "plugins">, spec: string, kind: string) {
  const [plugin = "", name = ""] = spec.split("/");
  return path.join(f.plugins, plugin, kind, name);
}
export function addRule(f: Fixture, spec: string, text: string) {
  const rule = pluginPath(f, spec, "rules");
  fs.mkdirSync(path.dirname(rule), { recursive: true });
  fs.writeFileSync(rule, text);
  return rule;
}
export function addSkill(f: Pick<Fixture, "plugins">, spec: string) {
  const skill = pluginPath(f, spec, "skills");
  const name = path.basename(skill);
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(
    path.join(skill, "SKILL.md"),
    `---\nname: ${name}\ndescription: Installer fixture\n---\nTest skill.\n`,
  );
  return skill;
}
export function addScript(f: Fixture, spec: string, executable = true) {
  const script = pluginPath(f, spec, "scripts");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, `#!/bin/sh\necho ${path.basename(script)}\n`);
  fs.chmodSync(script, executable ? 0o755 : 0o644);
  return script;
}
