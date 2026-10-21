// Where each agent keeps its MCP servers, and the entry shape it expects.
import path from 'node:path';

// Render the common {command, args, env} entry most agents use
const plain = ({ command, args, env }) => ({ command, args, env });

export const TARGETS = {
  zed: {
    // Zed's settings are JSONC and hold everything else Zed is configured with
    file: (env) => path.join(env.ZED_HOME, 'settings.json'),
    key: 'context_servers',
    jsonc: true,
    render: plain,
  },
  copilot: {
    // Copilot CLI wants an explicit transport type and a tool allowlist
    file: (env) => path.join(env.COPILOT_HOME, 'mcp-config.json'),
    key: 'mcpServers',
    jsonc: false,
    render: ({ command, args, env }) => ({
      type: 'stdio',
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      tools: ['*'],
    }),
  },
  claude: {
    // Claude Code keeps user-scope servers in ~/.claude.json, not under ~/.claude/
    file: (env) => path.join(env.HOME, '.claude.json'),
    key: 'mcpServers',
    jsonc: false,
    render: ({ command, args, env }) => ({ type: 'stdio', command, args, env }),
  },
  cursor: {
    file: (env) => path.join(env.CURSOR_HOME, 'mcp.json'),
    key: 'mcpServers',
    jsonc: false,
    render: plain,
  },
};

// Default homes match install.sh, so both agree without passing paths around
export function targetEnv(env) {
  const home = env.HOME;
  return {
    HOME: home,
    ZED_HOME: env.ZED_HOME || path.join(home, '.config', 'zed'),
    COPILOT_HOME: env.COPILOT_HOME || path.join(home, '.copilot'),
    CURSOR_HOME: env.CURSOR_HOME || path.join(home, '.cursor'),
    AGENTS_HOME: env.AGENTS_HOME || path.join(home, '.agents'),
  };
}

// Compare entries ignoring key order, treating missing args and env as empty
export function sameEntry(a, b) {
  const normalize = (entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    const filled = { args: [], env: {}, ...entry };
    return Object.fromEntries(Object.keys(filled).sort().map((key) => [key, filled[key]]));
  };
  const canonical = (value) => JSON.stringify(value, (key, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]]))
      : item));
  return canonical(normalize(a)) === canonical(normalize(b));
}
