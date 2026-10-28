// Locate plugin folders and list their contents, shared by the installer and mcp-call.
import fs from "node:fs";
import path from "node:path";
import { DEFAULTS_PLUGIN, readConfig } from "../plugins/config.ts";

// Sorted entries of a folder, skipping hidden ones as shell globs do, or none when it doesn't exist
export function list(dir: string): string[] {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => !name.startsWith("."))
        .sort()
    : [];
}

export const isDirectory = (file: string) =>
  fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;

// Defaults load first, then configured plugins in config order, then local-only plugins by name.
// Configured plugins that failed to clone are skipped.
export function findPlugins(repoRoot: string): string[] {
  const pluginsDir = path.join(repoRoot, "plugins");
  const configured = readConfig(repoRoot).map(({ name }) => name);
  const local = list(pluginsDir).filter(
    (name) => name !== DEFAULTS_PLUGIN && !configured.includes(name),
  );
  return [DEFAULTS_PLUGIN, ...configured, ...local]
    .map((name) => path.join(pluginsDir, name))
    .filter(isDirectory);
}
