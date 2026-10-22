// A fake stdio MCP server for tests: answers initialize, paginated tools/list, and tools/call.
// Set FAKE_MCP_CRASH=1 to exit on the first request after initialize.
import readline from "node:readline";

const PAGES = [
  {
    tools: [
      {
        name: "echo",
        description: "Echo arguments back. More detail here.",
        inputSchema: { type: "object" },
      },
    ],
    nextCursor: "p2",
  },
  {
    tools: [
      { name: "fail", description: "Always report an error.", inputSchema: { type: "object" } },
    ],
  },
];

// Write one JSON-RPC response line
const reply = (id, body) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);

// Dispatch each request line by method
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) {
    return;
  }
  // In crash mode, exit instead of answering anything after initialize
  if (process.env.FAKE_MCP_CRASH && method !== "initialize") {
    process.exit(3);
  }
  if (method === "initialize") {
    reply(id, {
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: {},
        serverInfo: { name: "fake" },
      },
    });
  } else if (method === "tools/list") {
    reply(id, { result: params?.cursor === "p2" ? PAGES[1] : PAGES[0] });
  } else if (method === "tools/call" && params.name === "echo") {
    reply(id, { result: { content: [{ type: "text", text: JSON.stringify(params.arguments) }] } });
  } else if (method === "tools/call" && params.name === "fail") {
    reply(id, { result: { isError: true, content: [{ type: "text", text: "nope" }] } });
  } else {
    reply(id, { error: { code: -32601, message: `unknown method ${method}` } });
  }
});
