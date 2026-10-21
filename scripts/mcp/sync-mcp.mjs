#!/usr/bin/env node
// Apply MCP servers declared in dotagents plugins to the selected agents' configs.
// Usage: sync-mcp.mjs [--check] --plugins <dir>... --targets <target>...
import { loadServers } from './declarations.mjs';
import { McpError } from './json.mjs';
import { sync } from './sync.mjs';
import { targetEnv } from './targets.mjs';

// Collect values after each flag until the next flag
function parseArgs(argv) {
  const options = { check: false, plugins: [], targets: [] };
  let list = null;
  for (const arg of argv) {
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--plugins' || arg === '--targets') {
      list = options[arg.slice(2)];
    } else if (list && !arg.startsWith('--')) {
      list.push(arg);
    } else {
      throw new McpError(`unexpected argument '${arg}'`);
    }
  }
  return options;
}

// Resolve every declaration first, so a missing command fails before any edit
try {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.HOME) throw new McpError('HOME is not set');
  const env = targetEnv(process.env);
  const servers = loadServers(options.plugins, { home: env.HOME, searchPath: process.env.PATH });
  sync({ servers, targets: options.targets, env, check: options.check });
} catch (error) {
  // Filesystem errors carry paths but not configuration values
  if (error instanceof McpError || error.code) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
