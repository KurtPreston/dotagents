// Load MCP server declarations from plugins and resolve their commands.
import fs from 'node:fs';
import path from 'node:path';
import { McpError, parseDocument } from './json.mjs';

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const ALLOWED_KEYS = new Set(['command', 'args', 'env']);

// Check a parsed declaration's shape, returning it with defaults filled in
function validate(value, label) {
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new McpError(`${label}: unsupported key "${key}" (expected command, args, env)`);
    }
  }
  if (typeof value.command !== 'string' || value.command === '') {
    throw new McpError(`${label}: "command" must be a non-empty string`);
  }

  // args is a list of strings, env a map of strings
  const args = value.args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
    throw new McpError(`${label}: "args" must be an array of strings`);
  }
  const env = value.env ?? {};
  if (env === null || typeof env !== 'object' || Array.isArray(env)
      || !Object.values(env).every((item) => typeof item === 'string')) {
    throw new McpError(`${label}: "env" must be an object of strings`);
  }
  return { command: value.command, args, env };
}

// Read every plugin's mcp/*.json in plugin order, failing on bad files or duplicate names
export function loadDeclarations(pluginDirs) {
  const servers = [];
  const owners = new Map();
  for (const pluginDir of pluginDirs) {
    const mcpDir = path.join(pluginDir, 'mcp');
    if (!fs.existsSync(mcpDir)) {
      continue;
    }

    // Only JSON files declare servers; their names come from the filename
    const plugin = path.basename(pluginDir);
    const files = fs.readdirSync(mcpDir).filter((file) => file.endsWith('.json')).sort();
    for (const file of files) {
      const name = file.slice(0, -'.json'.length);
      const label = `plugins/${plugin}/mcp/${file}`;
      if (!NAME_PATTERN.test(name)) {
        throw new McpError(`${label}: server names must match ${NAME_PATTERN}`);
      }

      // Server names share one namespace in every agent's config
      if (owners.has(name)) {
        throw new McpError(`MCP server '${name}' is in both plugins/${owners.get(name)} and plugins/${plugin} — rename one of them`);
      }
      owners.set(name, plugin);
      const text = fs.readFileSync(path.join(mcpDir, file), 'utf8');
      const { value } = parseDocument(text, { label });
      servers.push({ name, plugin, label, ...validate(value, label) });
    }
  }
  return servers;
}

// True when a path is a regular file this process may execute
function isExecutableFile(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// Turn a declared command into the absolute path agents should launch
export function resolveCommand(command, { home, searchPath, label }) {
  let resolved;
  if (command.startsWith('~/')) {
    resolved = path.join(home, command.slice(2));
  } else if (path.isAbsolute(command)) {
    resolved = command;
  } else if (command.includes('/')) {
    throw new McpError(`${label}: command "${command}" must be a bare name, an absolute path, or start with ~/`);
  } else {
    // Bare names are looked up the way a shell would, first match wins
    const dirs = (searchPath ?? '').split(path.delimiter).filter((dir) => path.isAbsolute(dir));
    resolved = dirs.map((dir) => path.join(dir, command)).find(isExecutableFile);
    if (resolved === undefined) {
      throw new McpError(`${label}: command "${command}" was not found on PATH — run ./install.sh from a shell where it is`);
    }
    return resolved;
  }

  // Paths given explicitly must still point at something runnable
  if (!isExecutableFile(resolved)) {
    throw new McpError(`${label}: command "${command}" is not an executable file`);
  }
  return resolved;
}

// Load declarations and resolve every command, so failures happen before any edits
export function loadServers(pluginDirs, { home, searchPath }) {
  return loadDeclarations(pluginDirs).map((server) => ({
    ...server,
    command: resolveCommand(server.command, { home, searchPath, label: server.label }),
  }));
}
