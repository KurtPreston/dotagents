// Where each agent keeps its MCP servers, and the entry shape it expects.
import path from "node:path";

export interface Server {
  name: string;
  plugin?: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface Homes {
  HOME: string;
  ZED_HOME: string;
  COPILOT_HOME: string;
  CURSOR_HOME: string;
  AGENTS_HOME: string;
}

export interface Target {
  file: (homes: Homes) => string;
  key: string;
  jsonc: boolean;
  render: (server: Server) => Record<string, unknown>;
}

export type TargetName = "zed" | "copilot" | "claude" | "cursor";

// Render the common {command, args, env} entry most agents use
const plain = ({ command, args, env }: Server) => ({ command, args, env });

export const TARGETS: Record<TargetName, Target> = {
  zed: {
    // Zed's settings are JSONC and hold everything else Zed is configured with
    file: (homes) => path.join(homes.ZED_HOME, "settings.json"),
    key: "context_servers",
    jsonc: true,
    render: plain,
  },
  copilot: {
    // Copilot CLI wants an explicit transport type and a tool allowlist
    file: (homes) => path.join(homes.COPILOT_HOME, "mcp-config.json"),
    key: "mcpServers",
    jsonc: false,
    render: ({ command, args, env }) => ({
      type: "stdio",
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      tools: ["*"],
    }),
  },
  claude: {
    // Claude Code keeps user-scope servers in ~/.claude.json, not under ~/.claude/
    file: (homes) => path.join(homes.HOME, ".claude.json"),
    key: "mcpServers",
    jsonc: false,
    render: ({ command, args, env }) => ({ type: "stdio", command, args, env }),
  },
  cursor: {
    file: (homes) => path.join(homes.CURSOR_HOME, "mcp.json"),
    key: "mcpServers",
    jsonc: false,
    render: plain,
  },
};

export function isTargetName(name: string): name is TargetName {
  return Object.hasOwn(TARGETS, name);
}

// Default homes match install.sh, so both agree without passing paths around
export function targetEnv(env: NodeJS.ProcessEnv): Homes {
  const home = env.HOME ?? "";
  return {
    HOME: home,
    ZED_HOME: env.ZED_HOME || path.join(home, ".config", "zed"),
    COPILOT_HOME: env.COPILOT_HOME || path.join(home, ".copilot"),
    CURSOR_HOME: env.CURSOR_HOME || path.join(home, ".cursor"),
    AGENTS_HOME: env.AGENTS_HOME || path.join(home, ".agents"),
  };
}

// Serialize with sorted object keys, so key order never affects comparison
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((name) => [name, (item as Record<string, unknown>)[name]]),
        )
      : item,
  );
}

// Compare entries ignoring key order, treating missing args and env as empty
export function sameEntry(a: unknown, b: unknown): boolean {
  const normalize = (entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? { args: [], env: {}, ...entry }
      : entry;
  return canonical(normalize(a)) === canonical(normalize(b));
}
