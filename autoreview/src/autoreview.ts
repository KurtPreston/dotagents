#!/usr/bin/env -S node --use-system-ca
// Command line for autoreview: two agents deliberate a pull request.
// `threads` lists a pull request's review threads (read-only, for checking access).
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { Gitea } from "./gitea.ts";
import { findToken, parseRemote } from "./remote.ts";

const USAGE = `usage: autoreview threads --pr <n> [--repo <dir>]`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      pr: { type: "string" },
      repo: { type: "string", default: "." },
    },
  });

  // Every command works on one pull request
  const [command] = positionals;
  const pr = Number(values.pr);
  if (command !== "threads" || !Number.isInteger(pr)) {
    console.error(USAGE);
    process.exit(2);
  }

  // Find the repository from its origin remote, and a token for its server
  const origin = execFileSync("git", ["-C", values.repo, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  const remote = parseRemote(origin);
  const token = await findToken(remote.url);
  if (!token) {
    throw new Error(`no token for ${remote.url}: set GITEA_TOKEN or log in with tea`);
  }
  const forge = new Gitea({ ...remote, token });

  // Print each thread with its comments
  for (const thread of await forge.threads(pr)) {
    console.log(`${thread.key}${thread.resolved ? " (resolved)" : ""}`);
    for (const comment of thread.comments) {
      console.log(`  ${comment.author}: ${comment.body.split("\n")[0]}`);
    }
  }
}

await main();
