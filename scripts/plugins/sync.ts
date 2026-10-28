// Clone or fast-forward each configured remote plugin into plugins/<name>.
// Local changes, diverged branches, and unreachable remotes are skipped with a warning, never discarded.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { InstallError } from "../lib/json.ts";
import type { RemotePlugin } from "./config.ts";

type Log = (line: string) => void;

interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

// Run git without prompting, so a missing credential fails instead of hanging
function git(args: string[], cwd?: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) {
    throw new InstallError(`git is needed to sync remote plugins (${result.error.message})`);
  }
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
}

// The first line of git's error output, for one-line warnings
const reason = (result: GitResult) => result.err.split("\n")[0] || "git failed";

// Clone a plugin that isn't on disk yet, checking out its ref when one is set
function clone(plugin: RemotePlugin, dir: string, log: Log): void {
  const branch = plugin.ref ? ["--branch", plugin.ref] : [];
  const result = git(["clone", "--quiet", ...branch, "--", plugin.git, dir]);
  if (!result.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    log(`warning: couldn't clone plugins/${plugin.name}: ${reason(result)}`);
    return;
  }
  log(`cloned plugins/${plugin.name}`);
}

// The branch a checkout should follow: its configured ref, or the remote's default branch
function targetRef(plugin: RemotePlugin, dir: string): string {
  if (plugin.ref) {
    return plugin.ref;
  }
  const head = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir);
  return head.ok ? head.out.replace(/^origin\//, "") : "HEAD";
}

// Fast-forward an existing checkout, or explain why it was left alone
function update(plugin: RemotePlugin, dir: string, log: Log): void {
  const label = `plugins/${plugin.name}`;
  const origin = git(["remote", "get-url", "origin"], dir);
  if (!origin.ok || origin.out !== plugin.git) {
    throw new InstallError(
      `${label} exists but isn't a clone of ${plugin.git} — move it, or rename the plugin in dotagents.jsonc`,
    );
  }

  // A branch checkout must be on the configured branch; detached checkouts follow tags
  const ref = targetRef(plugin, dir);
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], dir);
  if (branch.ok && ref !== "HEAD" && branch.out !== ref) {
    log(`warning: ${label} is on branch ${branch.out}, not ${ref}; leaving it as is`);
    return;
  }
  const fetched = git(["fetch", "--quiet", "--tags", "origin", ref], dir);
  if (!fetched.ok) {
    log(`warning: couldn't update ${label}: ${reason(fetched)}`);
    return;
  }

  // Nothing to do when already at the fetched commit
  const head = git(["rev-parse", "HEAD"], dir).out;
  const target = git(["rev-parse", "FETCH_HEAD"], dir).out;
  if (head === target) {
    log(`up to date ${label}`);
    return;
  }

  // Never touch uncommitted work, and only move forward along the remote's history
  if (git(["status", "--porcelain"], dir).out !== "") {
    log(`warning: ${label} has uncommitted changes; leaving it as is`);
    return;
  }
  if (branch.ok && !git(["merge-base", "--is-ancestor", "HEAD", target], dir).ok) {
    log(`warning: ${label} has commits not on ${ref}; leaving it as is`);
    return;
  }
  const moved = branch.ok
    ? git(["merge", "--quiet", "--ff-only", target], dir)
    : git(["checkout", "--quiet", "--detach", target], dir);
  if (!moved.ok) {
    log(`warning: couldn't update ${label}: ${reason(moved)}`);
    return;
  }
  log(`updated ${label} ${head.slice(0, 7)}..${target.slice(0, 7)}`);
}

// Bring every configured plugin up to date under pluginsDir
export function syncPlugins(
  plugins: RemotePlugin[],
  { pluginsDir, log = console.log }: { pluginsDir: string; log?: Log },
): void {
  for (const plugin of plugins) {
    const dir = path.join(pluginsDir, plugin.name);
    if (fs.existsSync(dir)) {
      update(plugin, dir, log);
    } else {
      fs.mkdirSync(pluginsDir, { recursive: true });
      clone(plugin, dir, log);
    }
  }
}
