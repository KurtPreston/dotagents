// Where each agent keeps its MCP servers, and the entry shape it expects.
import path from "node:path";
import { canonical, isObject } from "../lib/json.ts";

export interface Server {
  name: string;
  plugin?: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  // Installed into no agent; reached through the mcp-call CLI instead
  onDemand?: boolean;
  // Tool allowlist, for agents whose config supports one
  tools?: string[];
}

export interface Homes {
  HOME: string;
  ZED_HOME: string;
  COPILOT_HOME: string;
  CURSOR_HOME: string;
  CODEX_HOME: string;
  AGENTS_HOME: string;
}

export interface Target {
  file: (homes: Homes) => string;
  key: string;
  format: "json" | "jsonc" | "toml";
  render: (server: Server) => Record<string, unknown>;
}

export type TargetName = "zed" | "copilot" | "claude" | "cursor" | "codex";

// Render the common {command, args, env} entry most agents use
const plain = ({ command, args, env }: Server) => ({ command, args, env });

export const TARGETS: Record<TargetName, Target> = {
  zed: {
    // Zed's settings are JSONC and hold everything else Zed is configured with
    file: (homes) => path.join(homes.ZED_HOME, "settings.json"),
    key: "context_servers",
    format: "jsonc",
    render: plain,
  },
  copilot: {
    // Copilot CLI wants an explicit transport type and a tool allowlist
    file: (homes) => path.join(homes.COPILOT_HOME, "mcp-config.json"),
    key: "mcpServers",
    format: "json",
    render: ({ command, args, env, tools }) => ({
      type: "stdio",
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      tools: tools ?? ["*"],
    }),
  },
  claude: {
    // Claude Code keeps user-scope servers in ~/.claude.json, not under ~/.claude/
    file: (homes) => path.join(homes.HOME, ".claude.json"),
    key: "mcpServers",
    format: "json",
    render: ({ command, args, env }) => ({ type: "stdio", command, args, env }),
  },
  cursor: {
    file: (homes) => path.join(homes.CURSOR_HOME, "mcp.json"),
    key: "mcpServers",
    format: "json",
    render: plain,
  },
  codex: {
    // Codex keeps servers as [mcp_servers.<name>] tables in its TOML config
    file: (homes) => path.join(homes.CODEX_HOME, "config.toml"),
    key: "mcp_servers",
    format: "toml",
    render: ({ command, args, env, tools }) => ({
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(tools ? { enabled_tools: tools } : {}),
    }),
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
    CODEX_HOME: env.CODEX_HOME || path.join(home, ".codex"),
    AGENTS_HOME: env.AGENTS_HOME || path.join(home, ".agents"),
  };
}

// Compare entries ignoring key order, treating missing args and env as empty
export function sameEntry(a: unknown, b: unknown): boolean {
  const normalize = (entry: unknown) => (isObject(entry) ? { args: [], env: {}, ...entry } : entry);
  return canonical(normalize(a)) === canonical(normalize(b));
}
