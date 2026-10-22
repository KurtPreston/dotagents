// Locate plugin folders and list their contents, shared by the installer and mcp-call.
import fs from "node:fs";
import path from "node:path";

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

// The committed defaults plugin loads first, then every other plugin in name order
export function findPlugins(repoRoot: string): string[] {
  const pluginsDir = path.join(repoRoot, "plugins");
  const defaults = path.join(pluginsDir, "dotagents-defaults");
  const others = list(pluginsDir)
    .map((name) => path.join(pluginsDir, name))
    .filter((dir) => dir !== defaults && isDirectory(dir));
  return [defaults, ...others];
}
