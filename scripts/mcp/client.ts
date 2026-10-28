// A minimal MCP client over stdio: newline-delimited JSON-RPC, no SDK.
import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";

export interface ClientOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };

export class McpClient {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stderr = "";
  private timeoutMs: number;

  constructor({ command, args, env, timeoutMs = 120_000 }: ClientOptions) {
    this.timeoutMs = timeoutMs;

    // Launch the server, keeping its stderr for error messages
    this.child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr!.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });

    // Route each response line to the request waiting on its id
    const lines = readline.createInterface({ input: this.child.stdout! });
    lines.on("line", (line) => this.handleLine(line));

    // Fail every pending request if the server exits or can't start
    const failAll = (error: Error) => {
      for (const { reject } of this.pending.values()) {
        reject(error);
      }
      this.pending.clear();
    };
    this.child.on("error", failAll);
    this.child.on("exit", (code) =>
      failAll(new Error(`server exited with code ${code}${this.stderrTail()}`)),
    );
  }

  private stderrTail(): string {
    const tail = this.stderr.trim();
    return tail ? `\n${tail}` : "";
  }

  private handleLine(line: string) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = typeof message?.id === "number" ? this.pending.get(message.id) : undefined;
    if (!waiter || !("result" in message || "error" in message)) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(`${message.error.message ?? "error"} (code ${message.error.code})`));
    } else {
      waiter.resolve(message.result);
    }
  }

  private send(message: object) {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  // Send a request and wait for its response, or time out
  request(method: string, params?: object): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs} ms${this.stderrTail()}`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      this.send({ id, method, params });
    });
  }

  // Perform the initialize handshake
  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-call", version: "1.0.0" },
    });
    this.send({ method: "notifications/initialized" });
  }

  // List every tool, following pagination cursors
  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name: string, args: object): Promise<any> {
    return this.request("tools/call", { name, arguments: args });
  }

  close() {
    this.child.removeAllListeners("exit");
    this.child.stdin!.end();
    this.child.kill();
  }
}
