// Apply MCP servers declared in dotagents plugins to the selected agents' configs.
// Usage: node sync-mcp.ts [--check] --plugins <dir>... --targets <target>...
import { loadServers } from "./declarations.ts";
import { InstallError } from "../lib/json.ts";
import { sync } from "./sync.ts";
import { targetEnv } from "./targets.ts";

interface Options {
  check: boolean;
  plugins: string[];
  targets: string[];
}

// Collect values after each flag until the next flag
function parseArgs(argv: string[]): Options {
  const options: Options = { check: false, plugins: [], targets: [] };
  let list: string[] | null = null;
  for (const arg of argv) {
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--plugins" || arg === "--targets") {
      list = arg === "--plugins" ? options.plugins : options.targets;
    } else if (list && !arg.startsWith("--")) {
      list.push(arg);
    } else {
      throw new InstallError(`unexpected argument '${arg}'`);
    }
  }
  return options;
}

// Resolve every declaration first, so a missing command fails before any edit
try {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.HOME) {
    throw new InstallError("HOME is not set");
  }
  const env = targetEnv(process.env);
  const servers = loadServers(options.plugins, { home: env.HOME, searchPath: process.env.PATH });
  sync({ servers, targets: options.targets, env, check: options.check });
} catch (error) {
  // Filesystem errors carry paths but not configuration values
  if (error instanceof InstallError || (error as NodeJS.ErrnoException).code) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
  throw error;
}
