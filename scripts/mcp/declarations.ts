// Load MCP server declarations from plugins and resolve their commands.
import fs from "node:fs";
import path from "node:path";
import { InstallError, parseDocument } from "../lib/json.ts";
import type { JsonObject } from "../lib/json.ts";
import { findOnPath, isExecutableFile } from "../lib/path.ts";
import type { Server } from "./targets.ts";

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const ALLOWED_KEYS = new Set(["command", "args", "env", "load", "tools"]);
const LOAD_MODES = new Set(["static", "on-demand"]);

type Declaration = Pick<Server, "command" | "args" | "env" | "onDemand" | "tools">;

// Check a parsed declaration's shape, returning it with defaults filled in
function validate(value: JsonObject, label: string): Declaration {
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new InstallError(
        `${label}: unsupported key "${key}" (expected command, args, env, load, tools)`,
      );
    }
  }
  if (typeof value.command !== "string" || value.command === "") {
    throw new InstallError(`${label}: "command" must be a non-empty string`);
  }

  // args is a list of strings, env a map of strings
  const args = value.args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new InstallError(`${label}: "args" must be an array of strings`);
  }
  const env = value.env ?? {};
  if (
    env === null ||
    typeof env !== "object" ||
    Array.isArray(env) ||
    !Object.values(env).every((item) => typeof item === "string")
  ) {
    throw new InstallError(`${label}: "env" must be an object of strings`);
  }

  // load picks static (default) or on-demand; tools optionally allowlists tool names
  const load = value.load ?? "static";
  if (typeof load !== "string" || !LOAD_MODES.has(load)) {
    throw new InstallError(`${label}: "load" must be "static" or "on-demand"`);
  }
  const tools = value.tools;
  if (
    tools !== undefined &&
    (!Array.isArray(tools) ||
      tools.length === 0 ||
      !tools.every((tool) => typeof tool === "string"))
  ) {
    throw new InstallError(`${label}: "tools" must be a non-empty array of strings`);
  }

  // Optional fields appear only when set, so plain declarations stay plain
  return {
    command: value.command,
    args,
    env: env as Record<string, string>,
    ...(load === "on-demand" ? { onDemand: true } : {}),
    ...(tools !== undefined ? { tools: tools as string[] } : {}),
  };
}

// Read every plugin's mcp/*.json in plugin order, failing on bad files or duplicate names
export function loadDeclarations(pluginDirs: string[]): Server[] {
  const servers: Server[] = [];
  const owners = new Map<string, string>();
  for (const pluginDir of pluginDirs) {
    const mcpDir = path.join(pluginDir, "mcp");
    if (!fs.existsSync(mcpDir)) {
      continue;
    }

    // Only JSON files declare servers; their names come from the filename
    const plugin = path.basename(pluginDir);
    const files = fs
      .readdirSync(mcpDir)
      .filter((file) => file.endsWith(".json"))
      .sort();
    for (const file of files) {
      const name = file.slice(0, -".json".length);
      const label = `plugins/${plugin}/mcp/${file}`;
      if (!NAME_PATTERN.test(name)) {
        throw new InstallError(`${label}: server names must match ${NAME_PATTERN}`);
      }

      // Server names share one namespace in every agent's config
      const owner = owners.get(name);
      if (owner !== undefined) {
        throw new InstallError(
          `MCP server '${name}' is in both plugins/${owner} and plugins/${plugin} — rename one of them`,
        );
      }
      owners.set(name, plugin);
      const text = fs.readFileSync(path.join(mcpDir, file), "utf8");
      const { value } = parseDocument(text, { label });
      servers.push({ name, plugin, label, ...validate(value, label) });
    }
  }
  return servers;
}

interface ResolveOptions {
  home: string;
  searchPath: string | undefined;
  label: string;
}

// Turn a declared command into the absolute path agents should launch
export function resolveCommand(
  command: string,
  { home, searchPath, label }: ResolveOptions,
): string {
  let resolved: string | undefined;
  if (command.startsWith("~/")) {
    resolved = path.join(home, command.slice(2));
  } else if (path.isAbsolute(command)) {
    resolved = command;
  } else if (command.includes("/")) {
    throw new InstallError(
      `${label}: command "${command}" must be a bare name, an absolute path, or start with ~/`,
    );
  } else {
    // Bare names are looked up the way a shell would, first match wins
    resolved = findOnPath(command, searchPath);
    if (resolved === undefined) {
      throw new InstallError(
        `${label}: command "${command}" was not found on PATH — run ./install.sh from a shell where it is`,
      );
    }
    return resolved;
  }

  // Paths given explicitly must still point at something runnable
  if (!isExecutableFile(resolved)) {
    throw new InstallError(`${label}: command "${command}" is not an executable file`);
  }
  return resolved;
}

// Load declarations and resolve every command, so failures happen before any edits
export function loadServers(
  pluginDirs: string[],
  { home, searchPath }: { home: string; searchPath: string | undefined },
): Server[] {
  return loadDeclarations(pluginDirs).map((server) => ({
    ...server,
    command: resolveCommand(server.command, { home, searchPath, label: server.label }),
  }));
}
