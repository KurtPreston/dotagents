// mcp-call: list, inspect, or call the tools of a declared MCP server without loading it into an agent.
//
//   mcp-call                        list declared servers
//   mcp-call SERVER --list          list the server's tools with short descriptions
//   mcp-call SERVER --schema TOOL   print a tool's description and input schema
//   mcp-call SERVER TOOL [JSON]     call a tool with JSON arguments (default {})
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPlugins } from "../lib/plugins.ts";
import { loadDeclarations, resolveCommand } from "./declarations.ts";
import { McpClient, type Tool } from "./client.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const USAGE = `usage:
  mcp-call                        list declared servers
  mcp-call SERVER --list          list the server's tools
  mcp-call SERVER --schema TOOL   print a tool's input schema
  mcp-call SERVER TOOL [JSON]     call a tool with JSON arguments`;

// Shorten a description to its first sentence or line for listings
export function summarize(description: string | undefined, max = 120): string {
  const first = (description ?? "").trim().split(/\n|(?<=\.)\s/)[0] ?? "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

// Turn a tools/call result into printable text
export function renderResult(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
}): string {
  const parts = (result.content ?? []).map((item) =>
    item.type === "text" ? (item.text ?? "") : `[${item.type} content omitted]`,
  );
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  return parts.join("\n");
}

// Parse the JSON argument object, rejecting anything that isn't an object
function parseArgs(text: string | undefined): object {
  if (text === undefined) {
    return {};
  }
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return value;
}

async function main(argv: string[]): Promise<number> {
  // Find declarations; with no server named, list them
  const servers = loadDeclarations(findPlugins(REPO_ROOT));
  const [serverName, action, extra] = argv;
  if (serverName === undefined || serverName === "--help" || serverName === "-h") {
    console.log(USAGE);
    console.log(`\nservers: ${servers.map((s) => s.name).join(", ")}`);
    return 0;
  }
  const server = servers.find((s) => s.name === serverName);
  if (!server) {
    console.error(
      `unknown server "${serverName}" (declared: ${servers.map((s) => s.name).join(", ")})`,
    );
    return 2;
  }
  if (action === undefined) {
    console.error(USAGE);
    return 2;
  }

  // Start only the requested server so others missing from PATH don't matter
  const command = resolveCommand(server.command, {
    home: os.homedir(),
    searchPath: process.env.PATH,
    label: server.label,
  });
  const client = new McpClient({ command, args: server.args, env: server.env });
  try {
    await client.initialize();

    // List tools, or show one tool's schema
    if (action === "--list" || action === "--schema") {
      const tools = await client.listTools();
      if (action === "--list") {
        for (const tool of tools) {
          console.log(`${tool.name}: ${summarize(tool.description)}`);
        }
        return 0;
      }
      const tool = tools.find((t: Tool) => t.name === extra);
      if (!tool) {
        console.error(`unknown tool "${extra ?? ""}" on ${serverName}`);
        return 2;
      }
      console.log(
        JSON.stringify(
          { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
          null,
          2,
        ),
      );
      return 0;
    }

    // Call the tool and print its output, failing when the tool reports an error
    const result = await client.callTool(action, parseArgs(extra));
    console.log(renderResult(result));
    return result.isError ? 1 : 0;
  } finally {
    client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
