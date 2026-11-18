// Clone or fast-forward configured plugins, optionally returning them to their remote default branch.
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

// Return to the remote's current default branch without resetting local work
function checkoutDefault(plugin: RemotePlugin, dir: string, log: Log): void {
  const label = `plugins/${plugin.name}`;
  if (git(["status", "--porcelain"], dir).out !== "") {
    log(`warning: ${label} has uncommitted changes; leaving it as is`);
    return;
  }

  // Ask the remote rather than trusting a possibly stale origin/HEAD
  const remote = git(["ls-remote", "--symref", "origin", "HEAD"], dir);
  const ref = remote.out.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
  if (!remote.ok || !ref) {
    log(
      `warning: couldn't update ${label}: ${remote.ok ? "remote has no default branch" : reason(remote)}`,
    );
    return;
  }
  const fetched = git(
    ["fetch", "--quiet", "origin", `+refs/heads/${ref}:refs/remotes/origin/${ref}`],
    dir,
  );
  if (!fetched.ok) {
    log(`warning: couldn't update ${label}: ${reason(fetched)}`);
    return;
  }

  // Keep later normal installs following the default discovered from the remote
  git(["symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${ref}`], dir);
  const target = git(["rev-parse", `refs/remotes/origin/${ref}`], dir).out;

  // An existing default branch may only move forward; feature branches remain intact
  const localRef = `refs/heads/${ref}`;
  const exists = git(["show-ref", "--verify", "--quiet", localRef], dir).ok;
  if (exists && !git(["merge-base", "--is-ancestor", localRef, target], dir).ok) {
    log(`warning: ${label} has commits not on ${ref}; leaving it as is`);
    return;
  }
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], dir);
  if (!branch.ok && !git(["merge-base", "--is-ancestor", "HEAD", target], dir).ok) {
    log(`warning: ${label} has detached commits not on ${ref}; leaving it as is`);
    return;
  }

  // Switch without force, creating a tracking branch only when it doesn't exist
  const head = git(["rev-parse", "HEAD"], dir).out;
  const switched = exists
    ? git(["switch", "--quiet", "--no-guess", ref], dir)
    : git(["switch", "--quiet", "--create", ref, "--track", `origin/${ref}`], dir);
  const moved = switched.ok ? git(["merge", "--quiet", "--ff-only", target], dir) : switched;
  if (!moved.ok) {
    log(`warning: couldn't update ${label}: ${reason(moved)}`);
    return;
  }
  const unchanged = branch.out === ref && head === target;
  log(unchanged ? `up to date ${label}` : `updated ${label} to ${ref} (${target.slice(0, 7)})`);
}

// Fast-forward an existing checkout, or explain why it was left alone
function update(
  plugin: RemotePlugin,
  dir: string,
  { log, updatePlugins }: { log: Log; updatePlugins: boolean },
): void {
  const label = `plugins/${plugin.name}`;
  const origin = git(["remote", "get-url", "origin"], dir);
  if (!origin.ok || origin.out !== plugin.git) {
    throw new InstallError(
      `${label} exists but isn't a clone of ${plugin.git} — move it, or rename the plugin in dotagents.jsonc`,
    );
  }

  // Explicit updates return to the default branch, ignoring any configured pin for this run
  if (updatePlugins) {
    checkoutDefault(plugin, dir, log);
    return;
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
  {
    pluginsDir,
    log = console.log,
    updatePlugins = false,
  }: { pluginsDir: string; log?: Log; updatePlugins?: boolean },
): void {
  for (const plugin of plugins) {
    const dir = path.join(pluginsDir, plugin.name);
    if (fs.existsSync(dir)) {
      update(plugin, dir, { log, updatePlugins });
    } else {
      fs.mkdirSync(pluginsDir, { recursive: true });
      clone(updatePlugins ? { name: plugin.name, git: plugin.git } : plugin, dir, log);
    }
  }
}
