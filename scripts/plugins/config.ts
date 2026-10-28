// Read and edit dotagents.jsonc, the list of remote plugins the installer keeps in sync.
import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import { InstallError, decodeUtf8, isObject, parseDocument } from "../lib/json.ts";

export const CONFIG_NAME = "dotagents.jsonc";
export const DEFAULTS_PLUGIN = "dotagents-defaults";

export interface RemotePlugin {
  name: string;
  git: string;
  ref?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const NEW_CONFIG = `// Remote plugins dotagents clones into plugins/ and updates on every install.
// See dotagents.example.jsonc for the format.
{
  "plugins": []
}
`;

export const configPath = (repoRoot: string) => path.join(repoRoot, CONFIG_NAME);

// Check one entry's shape, naming its position on failure
function parseEntry(entry: unknown, label: string): RemotePlugin {
  if (!isObject(entry)) {
    throw new InstallError(`${label} must be an object`);
  }
  const { name, git, ref, ...rest } = entry;
  const extra = Object.keys(rest)[0];
  if (extra !== undefined) {
    throw new InstallError(`${label} has unknown key '${extra}'`);
  }
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name === DEFAULTS_PLUGIN) {
    throw new InstallError(`${label}.name must be a folder name other than ${DEFAULTS_PLUGIN}`);
  }
  if (typeof git !== "string" || git === "") {
    throw new InstallError(`${label}.git must be a repository URL`);
  }
  if (ref !== undefined && (typeof ref !== "string" || ref === "")) {
    throw new InstallError(`${label}.ref must be a branch or tag name`);
  }
  return { name, git, ...(ref !== undefined && { ref }) };
}

// The configured remote plugins in file order, or none when there's no config file
export function readConfig(repoRoot: string): RemotePlugin[] {
  const file = configPath(repoRoot);
  if (!fs.existsSync(file)) {
    return [];
  }
  const text = decodeUtf8(fs.readFileSync(file), file);
  const { plugins = [] } = parseDocument(text, { label: file, jsonc: true }).value;
  if (!Array.isArray(plugins)) {
    throw new InstallError(`${file}: plugins must be an array`);
  }

  // Validate every entry, and reject names used twice
  const entries = plugins.map((entry, index) => parseEntry(entry, `${file}: plugins[${index}]`));
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (seen.has(name)) {
      throw new InstallError(`${file}: plugin '${name}' is listed twice`);
    }
    seen.add(name);
  }
  return entries;
}

// A plugin name from its repository URL, such as team-agents from git@host:org/team-agents.git
export function nameFromUrl(url: string): string {
  return (
    url
      .replace(/[/\\]+$/, "")
      .split(/[/:\\]/)
      .at(-1)
      ?.replace(/\.git$/, "") ?? ""
  );
}

// Append a plugin to the config, creating the file if needed, and return the entry added
export function addPlugin(
  repoRoot: string,
  { git, name = nameFromUrl(git), ref }: { git: string; name?: string; ref?: string },
): RemotePlugin {
  const file = configPath(repoRoot);
  const existing = readConfig(repoRoot);
  const entry = parseEntry({ name, git, ...(ref !== undefined && { ref }) }, `plugin '${name}'`);
  if (existing.some((plugin) => plugin.name === entry.name)) {
    throw new InstallError(`${file}: plugin '${entry.name}' is already listed`);
  }

  // Insert at the end of the plugins array, leaving comments and other entries as they were
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : NEW_CONFIG;
  const edits = modify(text, ["plugins", -1], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    isArrayInsertion: true,
  });
  fs.writeFileSync(file, applyEdits(text, edits));
  return entry;
}
