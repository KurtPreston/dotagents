// Installer integration tests for remote plugins listed in dotagents.jsonc.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nameFromUrl } from "../scripts/plugins/config.ts";
import { addRule, assertPreflightFailure, fixture, install, skip } from "./support/installer.ts";

// Run git with a fixed identity and isolated from host config, returning trimmed output
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    {
      cwd,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

// Remote fixture: bare repositories with a working clone to commit rules from
function remoteFixture(t: TestContext) {
  const f = fixture(t);
  const config = path.join(f.repo, "dotagents.jsonc");
  const remotes = path.join(f.root, "remotes");

  // Create a remote whose main branch holds one rule
  const addRemote = (name: string, rule = `## ${name}\n`) => {
    const bare = path.join(remotes, `${name}.git`);
    const work = path.join(remotes, `${name}-work`);
    fs.mkdirSync(bare, { recursive: true });
    git(bare, "init", "--quiet", "--bare", "--initial-branch=main");
    git(remotes, "clone", "--quiet", bare, work);
    git(work, "checkout", "--quiet", "-b", "main");
    return { bare, work, commit: (text = rule) => commitRule(work, text) };
  };
  const commitRule = (work: string, text: string) => {
    fs.mkdirSync(path.join(work, "rules"), { recursive: true });
    fs.writeFileSync(path.join(work, "rules", "rule.md"), text);
    git(work, "add", "-A");
    git(work, "commit", "--quiet", "-m", "rule");
    git(work, "push", "--quiet", "origin", "HEAD");
    return git(work, "rev-parse", "HEAD");
  };

  // Write the config, and read a cloned plugin's rule or commit
  const writeConfig = (plugins: object[]) =>
    fs.writeFileSync(config, `// test config\n${JSON.stringify({ plugins }, null, 2)}\n`);
  const cloned = (name: string) => path.join(f.plugins, name);
  const headOf = (name: string) => git(cloned(name), "rev-parse", "HEAD");
  return { f, config, addRemote, writeConfig, cloned, headOf };
}

test("installer remote plugins", { skip }, async (t) => {
  await t.test("configured plugins are cloned and their rules ordered", (t) => {
    const r = remoteFixture(t);
    const zulu = r.addRemote("zulu");
    zulu.commit("## Zulu\n");
    const alpha = r.addRemote("alpha");
    alpha.commit("## Alpha\n");
    addRule(r.f, "local/rules.md", "## Local\n");
    r.writeConfig([
      { name: "zulu", git: zulu.bare },
      { name: "alpha", git: alpha.bare },
    ]);
    const result = install(r.f, ["claude"]);
    assert.match(result.stdout, /cloned plugins\/zulu/);

    // Defaults come first, then config order, then local-only plugins
    const agents = fs.readFileSync(r.f.agents, "utf8");
    const order = ["## Background Processes", "## Zulu", "## Alpha", "## Local"].map((text) =>
      agents.indexOf(text),
    );
    assert.ok(
      order.every((at) => at >= 0),
      agents,
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
  });

  await t.test("a rerun fast-forwards to the remote", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit("## One\n");
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);
    const latest = remote.commit("## Two\n");
    const result = install(r.f, ["claude"]);
    assert.match(result.stdout, /updated plugins\/team/);
    assert.equal(r.headOf("team"), latest);
    assert.match(fs.readFileSync(r.f.agents, "utf8"), /## Two/);
    assert.match(install(r.f, ["claude"]).stdout, /up to date plugins\/team/);
  });

  for (const flag of ["-u", "--update-plugins"]) {
    await t.test(`${flag} returns every configured plugin to its default branch`, (t) => {
      const r = remoteFixture(t);
      const first = r.addRemote("first");
      first.commit();
      const second = r.addRemote("second");
      second.commit();
      git(second.work, "branch", "--move", "master");
      git(second.work, "push", "--quiet", "origin", "master");
      git(second.bare, "--git-dir", second.bare, "symbolic-ref", "HEAD", "refs/heads/master");
      r.writeConfig([
        { name: "first", git: first.bare },
        { name: "second", git: second.bare },
      ]);
      install(r.f, ["claude"]);

      // Ordinary installs leave feature branches alone, even at the same commit
      for (const name of ["first", "second"]) {
        git(r.cloned(name), "checkout", "--quiet", "-b", "feature");
      }
      assert.match(install(r.f, ["claude"]).stdout, /is on branch feature/);
      const latest = first.commit("## Updated first\n");
      const result = install(r.f, ["claude", flag]);
      assert.match(result.stdout, /updated plugins\/first to main/);
      assert.match(result.stdout, /updated plugins\/second to master/);
      assert.equal(r.headOf("first"), latest);
      assert.match(fs.readFileSync(r.f.agents, "utf8"), /## Updated first/);

      // Both aliases select the actual branch, not just its commit
      assert.equal(git(r.cloned("first"), "branch", "--show-current"), "main");
      assert.equal(git(r.cloned("second"), "branch", "--show-current"), "master");
      assert.match(install(r.f, [flag, "claude"]).stdout, /up to date plugins\/first/);
    });
  }

  await t.test("--update-plugins preserves commits on feature branches", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit("## Main\n");
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // Unpushed feature commits remain reachable after returning to main
    git(r.cloned("team"), "checkout", "--quiet", "-b", "feature");
    fs.writeFileSync(path.join(r.cloned("team"), "rules", "rule.md"), "## Feature\n");
    git(r.cloned("team"), "commit", "--quiet", "-am", "feature");
    const feature = r.headOf("team");
    const latest = remote.commit("## Latest main\n");
    install(r.f, ["-u", "claude"]);
    assert.equal(r.headOf("team"), latest);
    assert.equal(git(r.cloned("team"), "rev-parse", "feature"), feature);
  });

  await t.test("--update-plugins creates a missing local default branch", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    const latest = remote.commit();
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // A feature-only checkout gets a new tracking branch without resetting anything
    git(r.cloned("team"), "branch", "--move", "feature");
    install(r.f, ["--update-plugins", "claude"]);
    assert.equal(git(r.cloned("team"), "branch", "--show-current"), "main");
    assert.equal(git(r.cloned("team"), "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/main");
    assert.equal(r.headOf("team"), latest);
  });

  await t.test("--update-plugins discovers a changed remote default branch", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit();
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // origin/HEAD still names main after the remote changes its default to trunk
    git(remote.work, "checkout", "--quiet", "-b", "trunk");
    const latest = remote.commit("## Trunk\n");
    git(remote.bare, "--git-dir", remote.bare, "symbolic-ref", "HEAD", "refs/heads/trunk");
    install(r.f, ["-u", "claude"]);
    assert.equal(git(r.cloned("team"), "branch", "--show-current"), "trunk");
    assert.equal(r.headOf("team"), latest);

    // Later ordinary installs follow the new default, too
    const next = remote.commit("## New trunk\n");
    install(r.f, ["claude"]);
    assert.equal(r.headOf("team"), next);
  });

  await t.test(
    "--update-plugins overrides pins for existing and missing clones only for this run",
    (t) => {
      const r = remoteFixture(t);
      const remote = r.addRemote("team");
      const pinned = remote.commit("## Pinned\n");
      git(remote.work, "tag", "v1");
      git(remote.work, "push", "--quiet", "origin", "v1");
      const latest = remote.commit("## Latest\n");
      r.writeConfig([
        { name: "existing", git: remote.bare, ref: "v1" },
        { name: "missing", git: remote.bare, ref: "v1" },
      ]);

      // Start with just one pinned checkout; the flag also applies when cloning the other
      git(r.f.plugins, "clone", "--quiet", "--branch", "v1", remote.bare, r.cloned("existing"));
      assert.equal(r.headOf("existing"), pinned);
      const config = fs.readFileSync(r.config, "utf8");
      install(r.f, ["-u", "claude"]);
      for (const name of ["existing", "missing"]) {
        assert.equal(git(r.cloned(name), "branch", "--show-current"), "main");
        assert.equal(r.headOf(name), latest);
      }
      assert.equal(fs.readFileSync(r.config, "utf8"), config);
    },
  );

  await t.test("--update-plugins leaves dirty feature branches untouched", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    const before = remote.commit();
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // Neither tracked edits nor untracked files may be carried onto another branch
    git(r.cloned("team"), "checkout", "--quiet", "-b", "feature");
    for (const file of ["rules/rule.md", "untracked.md"]) {
      const edited = path.join(r.cloned("team"), file);
      fs.writeFileSync(edited, "## Edited\n");
      const result = install(r.f, ["--update-plugins", "claude"]);
      assert.match(result.stdout, /plugins\/team has uncommitted changes/);
      assert.equal(git(r.cloned("team"), "branch", "--show-current"), "feature");
      assert.equal(r.headOf("team"), before);
      assert.equal(fs.readFileSync(edited, "utf8"), "## Edited\n");
      git(r.cloned("team"), "restore", "rules/rule.md");
    }
  });

  await t.test("--update-plugins won't reset local default-branch commits", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit();
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // Detect an ahead or diverged default branch even while a feature branch is checked out
    fs.writeFileSync(path.join(r.cloned("team"), "rules", "rule.md"), "## Mine\n");
    git(r.cloned("team"), "commit", "--quiet", "-am", "mine");
    const mine = r.headOf("team");
    git(r.cloned("team"), "checkout", "--quiet", "-b", "feature");
    for (const diverged of [false, true]) {
      if (diverged) {
        remote.commit("## Remote\n");
      }
      const result = install(r.f, ["-u", "claude"]);
      assert.match(result.stdout, /plugins\/team has commits not on main/);
      assert.equal(git(r.cloned("team"), "branch", "--show-current"), "feature");
      assert.equal(r.headOf("team"), mine);
      assert.equal(git(r.cloned("team"), "rev-parse", "main"), mine);
    }
  });

  await t.test("--update-plugins preserves unreferenced detached commits", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit();
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // A detached local commit has no branch to keep it reachable after switching away
    git(r.cloned("team"), "checkout", "--quiet", "--detach");
    fs.writeFileSync(path.join(r.cloned("team"), "rules", "rule.md"), "## Detached\n");
    git(r.cloned("team"), "commit", "--quiet", "-am", "detached");
    const detached = r.headOf("team");
    const result = install(r.f, ["-u", "claude"]);
    assert.match(result.stdout, /plugins\/team has detached commits not on main/);
    assert.equal(git(r.cloned("team"), "branch", "--show-current"), "");
    assert.equal(r.headOf("team"), detached);
  });

  await t.test("--update-plugins warns on unreachable remotes without switching branches", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    const before = remote.commit();
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);

    // An offline install still uses the checkout's existing content
    git(r.cloned("team"), "checkout", "--quiet", "-b", "feature");
    fs.rmSync(remote.bare, { recursive: true });
    const result = install(r.f, ["--update-plugins", "claude"]);
    assert.match(result.stdout, /couldn't update plugins\/team/);
    assert.equal(git(r.cloned("team"), "branch", "--show-current"), "feature");
    assert.equal(r.headOf("team"), before);
  });

  await t.test("uncommitted changes are left alone", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit("## One\n");
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);
    fs.writeFileSync(path.join(r.cloned("team"), "rules", "rule.md"), "## Edited\n");
    const before = r.headOf("team");
    remote.commit("## Two\n");
    const result = install(r.f, ["claude"]);
    assert.match(result.stdout, /plugins\/team has uncommitted changes/);
    assert.equal(r.headOf("team"), before);
    assert.match(fs.readFileSync(r.f.agents, "utf8"), /## Edited/);
  });

  await t.test("local commits are left alone", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit("## One\n");
    r.writeConfig([{ name: "team", git: remote.bare }]);
    install(r.f, ["claude"]);
    fs.writeFileSync(path.join(r.cloned("team"), "rules", "rule.md"), "## Mine\n");
    git(r.cloned("team"), "commit", "--quiet", "-am", "mine");
    const mine = r.headOf("team");
    remote.commit("## Two\n");
    const result = install(r.f, ["claude"]);
    assert.match(result.stdout, /plugins\/team has commits not on main/);
    assert.equal(r.headOf("team"), mine);
  });

  await t.test("an unreachable remote warns and installs what's there", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit("## One\n");
    r.writeConfig([
      { name: "team", git: remote.bare },
      { name: "gone", git: path.join(r.f.root, "missing.git") },
    ]);
    install(r.f, ["claude"]);
    fs.rmSync(remote.bare, { recursive: true });
    const result = install(r.f, ["claude"]);
    assert.match(result.stdout, /couldn't update plugins\/team/);
    assert.match(result.stdout, /couldn't clone plugins\/gone/);
    assert.ok(!fs.existsSync(r.cloned("gone")));
    assert.match(fs.readFileSync(r.f.agents, "utf8"), /## One/);
  });

  await t.test("a ref pins a tag", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    const first = remote.commit("## One\n");
    git(remote.work, "tag", "v1");
    git(remote.work, "push", "--quiet", "origin", "v1");
    remote.commit("## Two\n");
    r.writeConfig([{ name: "team", git: remote.bare, ref: "v1" }]);
    install(r.f, ["claude"]);
    assert.equal(r.headOf("team"), first);

    // Moving the tag moves the checkout
    const second = git(remote.work, "rev-parse", "HEAD");
    git(remote.work, "tag", "-f", "v2");
    git(remote.work, "push", "--quiet", "origin", "v2");
    r.writeConfig([{ name: "team", git: remote.bare, ref: "v2" }]);
    install(r.f, ["claude"]);
    assert.equal(r.headOf("team"), second);
  });

  await t.test("a folder that isn't the configured clone fails before installing", (t) => {
    const r = remoteFixture(t);
    addRule(r.f, "team/rule.md", "## Local\n");
    r.writeConfig([{ name: "team", git: path.join(r.f.root, "elsewhere.git") }]);
    const result = assertPreflightFailure(r.f, ["claude"]);
    assert.match(result.stderr, /plugins\/team exists but isn't a clone/);
  });

  await t.test("an invalid config fails before installing", (t) => {
    const r = remoteFixture(t);
    r.writeConfig([{ name: "../escape", git: "x" }]);
    const result = assertPreflightFailure(r.f, ["claude"]);
    assert.match(result.stderr, /plugins\[0\]\.name/);
    r.writeConfig([{ name: "dotagents-defaults", git: "x" }]);
    assertPreflightFailure(r.f, ["claude"]);
  });

  await t.test("--add records the plugin, keeping comments, then installs it", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team-agents");
    remote.commit("## Team\n");
    r.writeConfig([]);
    install(r.f, ["--add", remote.bare, "claude"]);
    const text = fs.readFileSync(r.config, "utf8");
    assert.match(text, /^\/\/ test config/);
    assert.match(text, /"name": "team-agents"/);
    assert.match(fs.readFileSync(r.f.agents, "utf8"), /## Team/);

    // Adding the same name again fails, as does --ref without --add
    assertPreflightFailure(r.f, ["--add", remote.bare, "claude"]);
    assertPreflightFailure(r.f, ["--ref", "main", "claude"]);
  });

  await t.test("--add creates the config with a chosen name and ref", (t) => {
    const r = remoteFixture(t);
    const remote = r.addRemote("team");
    remote.commit("## Team\n");
    git(remote.work, "checkout", "--quiet", "-b", "next");
    remote.commit("## Next\n");
    git(remote.work, "push", "--quiet", "origin", "next");
    install(r.f, ["--add", remote.bare, "--name", "mine", "--ref", "next", "claude"]);
    assert.ok(fs.existsSync(path.join(r.cloned("mine"), "rules")));
    assert.match(fs.readFileSync(r.config, "utf8"), /"ref": "next"/);
  });
});

test("runner action installs configured plugins", { skip }, (t) => {
  const r = remoteFixture(t);
  const remote = r.addRemote("team");
  remote.commit("## Team\n");

  // The workspace holds the config; a git wrapper records the auth config it was given
  const workspace = path.join(r.f.root, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(
    path.join(workspace, "agents.jsonc"),
    JSON.stringify({ plugins: [{ name: "team", git: remote.bare }] }),
  );
  const gitLog = path.join(r.f.root, "git.log");
  const realGit = fs.realpathSync(path.join(r.f.bin, "git"));
  fs.rmSync(path.join(r.f.bin, "git"));
  fs.writeFileSync(
    path.join(r.f.bin, "git"),
    `#!/bin/sh\necho "$GIT_CONFIG_KEY_0 $GIT_CONFIG_KEY_1=$GIT_CONFIG_VALUE_1" >> "${gitLog}"\nexec "${realGit}" "$@"\n`,
    { mode: 0o755 },
  );
  for (const command of ["bash", "cp", "base64", "tr"]) {
    fs.symlinkSync(
      execFileSync("which", [command], { encoding: "utf8" }).trim(),
      path.join(r.f.bin, command),
    );
  }

  // Run the action's script the way action.yml does
  const githubEnv = path.join(r.f.root, "github env");
  const env = Object.fromEntries(Object.entries(r.f.env).filter(([key]) => !key.endsWith("_HOME")));
  const result = spawnSync(path.join(r.f.repo, "scripts", "action.sh"), [], {
    cwd: r.f.root,
    encoding: "utf8",
    env: {
      ...env,
      TARGETS: "claude",
      CONFIG: "agents.jsonc",
      TOKEN: "secret-token",
      GITHUB_WORKSPACE: workspace,
      GITHUB_SERVER_URL: "https://git.example",
      RUNNER_TEMP: path.join(r.f.root, "runner"),
      GITHUB_ENV: githubEnv,
    },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /cloned plugins\/team/);
  assert.match(fs.readFileSync(r.f.agents, "utf8"), /## Team/);
  assert.match(
    fs.readFileSync(path.join(r.f.root, "runner", "dotagents", "claude", "CLAUDE.md"), "utf8"),
    /## Team/,
  );

  // Git got the token's header and SSH rewrite; later steps don't get the token
  assert.match(
    fs.readFileSync(gitLog, "utf8"),
    /http\.https:\/\/git\.example\/\.extraheader url\.https:\/\/git\.example\/\.insteadOf=git@git\.example:/,
  );
  assert.match(result.stdout, /::add-mask::/);
  assert.doesNotMatch(fs.readFileSync(githubEnv, "utf8"), /GIT_CONFIG|secret/);
});

test("plugin names come from repository URLs", () => {
  assert.equal(nameFromUrl("git@github.com:example/team-agents.git"), "team-agents");
  assert.equal(nameFromUrl("https://github.com/example/team/"), "team");
  assert.equal(nameFromUrl("/tmp/remotes/local.git"), "local");
});
