// Apply declared MCP servers to agent config files with safe, minimal edits.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";
import type { Node } from "jsonc-parser";
import { McpError, parseDocument } from "./json.ts";
import { TARGETS, isTargetName, sameEntry } from "./targets.ts";
import type { Homes, Server, TargetName } from "./targets.ts";

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };
const PARSE = { allowTrailingComma: true };

export interface Snapshot {
  raw: Buffer;
  identity: string;
  mode: number;
}

// Render a value as indented JSON whose continuation lines start at the given indent
function indentJson(value: unknown, indent: string): string {
  return JSON.stringify(value, null, 2).split("\n").join(`\n${indent}`);
}

// Append a property after an object's last one, on its own line at the same indent.
// jsonc-parser's formatter would also reflow the previous sibling's line, so this
// writes the text directly and leaves every existing line as it was.
function appendProperty(
  text: string,
  objectNode: Node,
  property: { name: string; value: unknown },
): string | null {
  const last = objectNode.children?.at(-1);
  if (last === undefined) {
    return null;
  }
  const end = last.offset + last.length;
  const lineStart = text.lastIndexOf("\n", last.offset - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  const indent = text.slice(lineStart, last.offset);
  if (lineEnd === -1 || !/^[ \t]*$/.test(indent)) {
    return null;
  }

  // Keep any trailing comma or line comment with the property it belongs to
  const rest = text.slice(end, lineEnd);
  const line = `${JSON.stringify(property.name)}: ${indentJson(property.value, indent)}`;
  if (/^\s*,/.test(rest)) {
    return `${text.slice(0, lineEnd)}\n${indent}${line},${text.slice(lineEnd)}`;
  }
  return `${text.slice(0, end)},${rest}\n${indent}${line}${text.slice(lineEnd)}`;
}

// Remove a property whose text occupies whole lines, leaving neighboring lines as they were
function removeProperty(text: string, objectNode: Node, property: Node): string | null {
  const siblings = objectNode.children ?? [];
  const index = siblings.indexOf(property);
  const start = text.lastIndexOf("\n", property.offset - 1) + 1;
  const after = text.indexOf("\n", property.offset + property.length);
  const tail = after === -1 ? null : text.slice(property.offset + property.length, after);
  if (
    !/^[ \t]*$/.test(text.slice(start, property.offset)) ||
    tail === null ||
    !/^\s*,?\s*(\/\/.*)?$/.test(tail)
  ) {
    return null;
  }
  let result = text.slice(0, start) + text.slice(after + 1);

  // A removed last property leaves its predecessor's comma dangling, unless commas trail by style
  const previous = siblings[index - 1];
  const isLast = index === siblings.length - 1;
  if (isLast && previous && !/^\s*,/.test(tail)) {
    const end = previous.offset + previous.length;
    const comma = result.slice(end).match(/^\s*,/);
    if (comma) {
      const at = end + comma[0].length - 1;
      result = result.slice(0, at) + result.slice(at + 1);
    }
  }
  return result;
}

// Set or remove one server under a top-level key, touching as little text as possible
export function setServer(text: string, [key, name]: [string, string], value: unknown): string {
  const root = parseTree(text, [], PARSE);
  const container = root && findNodeAtLocation(root, [key]);
  const exists = root && findNodeAtLocation(root, [key, name]);
  if (value === undefined) {
    if (!container || !exists?.parent) {
      return text;
    }
    const removed = removeProperty(text, container, exists.parent);
    return removed ?? applyEdits(text, modify(text, [key, name], undefined, {}));
  }

  // New servers go after the last sibling, or create the key after the last root property
  if (root && !exists) {
    const [parent, property] = container
      ? [container, { name, value }]
      : [root, { name: key, value: { [name]: value } }];
    if (parent.type === "object" && parent.children?.length) {
      const appended = appendProperty(text, parent, property);
      if (appended !== null) {
        return appended;
      }
    }
  }

  // Replacements, empty objects, and one-line files are safe to let jsonc-parser format
  return applyEdits(text, modify(text, [key, name], value, FORMAT));
}

// Read a regular file without following links, with an identity to detect later changes
export function snapshot(file: string): Snapshot | null {
  let metadata: fs.Stats;
  try {
    metadata = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!metadata.isFile()) {
    throw new McpError(`${file}: destination must be a regular file, not a symlink`);
  }

  // Reject links swapped in between the metadata check and open
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const raw = fs.readFileSync(fd);
    const identity = [
      opened.dev,
      opened.ino,
      opened.size,
      opened.mtimeNs,
      opened.ctimeNs,
      opened.mode,
      opened.uid,
      opened.gid,
    ].join(":");
    return { raw, identity, mode: Number(opened.mode) & 0o777 };
  } finally {
    fs.closeSync(fd);
  }
}

// Write bytes to a uniquely named sibling file with the given permissions
function stageFile(
  target: string,
  raw: string | Buffer,
  { mode, suffix }: { mode: number; suffix: string },
): string {
  const name = `${target}.${crypto.randomBytes(6).toString("hex")}${suffix}`;
  const fd = fs.openSync(name, "wx", mode);
  try {
    fs.writeFileSync(fd, raw);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(name, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  return name;
}

type State = Partial<Record<TargetName, string[]>>;

// Read the per-target list of server names dotagents installed
export function readState(file: string): State {
  const current = snapshot(file);
  if (current === null) {
    return {};
  }
  const { value } = parseDocument(current.raw.toString("utf8"), { label: file });
  for (const [target, names] of Object.entries(value)) {
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
      throw new McpError(`${file}: "${target}" must be an array of server names`);
    }
  }
  return value as State;
}

export interface Plan {
  target: TargetName;
  file: string;
  current: Snapshot | null;
  text: string;
  changed: boolean;
  names: string[];
}

interface PlanInput {
  target: TargetName;
  file: string;
  servers: Server[];
  managed: string[];
}

// Work out the edited text for one target without touching the disk
export function planTarget({ target: targetName, file, servers, managed }: PlanInput): Plan {
  const target = TARGETS[targetName];
  const current = snapshot(file);
  let text = current === null ? "{}\n" : current.raw.toString("utf8");
  const { value } = parseDocument(text, { jsonc: target.jsonc, label: file });

  // The servers map must be an object if it exists
  const existing = value[target.key] ?? {};
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    throw new McpError(`${file}: "${target.key}" must be an object`);
  }
  const entries = existing as Record<string, unknown>;
  const edit = (name: string, entry: unknown) => {
    text = setServer(text, [target.key, name], entry);
  };

  // Add or replace declared servers; adopt identical hand-made ones, refuse different ones
  const declared = new Set<string>();
  for (const server of servers) {
    declared.add(server.name);
    const rendered = target.render(server);
    const found = Object.hasOwn(entries, server.name);
    if (found && sameEntry(entries[server.name], rendered)) {
      continue;
    }
    if (found && !managed.includes(server.name)) {
      throw new McpError(
        `${file}: "${target.key}" already has a "${server.name}" server that dotagents didn't install and that differs from ${server.label} — remove or rename it, then rerun`,
      );
    }
    edit(server.name, rendered);
  }

  // Remove servers dotagents installed earlier that no plugin declares anymore
  for (const name of managed) {
    if (!declared.has(name) && Object.hasOwn(entries, name)) {
      edit(name, undefined);
    }
  }
  const changed = current === null ? declared.size > 0 : text !== current.raw.toString("utf8");
  return { target: targetName, file, current, text, changed, names: [...declared].sort() };
}

// Replace a file atomically, backing up the original and refusing concurrent changes
export function writePlanned(
  { file, current, text }: Pick<Plan, "file" | "current" | "text">,
  { backup = true }: { backup?: boolean } = {},
): string | null {
  const mode = current ? current.mode : 0o600;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = stageFile(file, text, { mode, suffix: ".tmp" });
  try {
    const unchanged = () => (snapshot(file)?.identity ?? null) === (current?.identity ?? null);
    if (!unchanged()) {
      throw new McpError(`${file}: destination changed; retry installation`);
    }

    // Keep the exact original bytes, owner-only, before replacing
    let backupPath: string | null = null;
    if (current !== null && backup) {
      backupPath = stageFile(file, current.raw, { mode: 0o600, suffix: ".bak" });
    }
    if (!unchanged()) {
      throw new McpError(`${file}: destination changed; retry installation`);
    }
    fs.renameSync(temporary, file);
    return backupPath;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export interface SyncOptions {
  servers: Server[];
  targets: string[];
  env: Homes;
  check?: boolean;
  log?: (line: string) => void;
}

// Validate every selected target, then apply them in order, recording ownership as each lands
export function sync({
  servers,
  targets,
  env,
  check = false,
  log = console.log,
}: SyncOptions): void {
  const names = targets.map((name) => {
    if (!isTargetName(name)) {
      throw new McpError(
        `unknown MCP target '${name}' (expected ${Object.keys(TARGETS).join(", ")})`,
      );
    }
    return name;
  });
  const stateFile = path.join(env.AGENTS_HOME, "state", "mcp.json");
  const state = readState(stateFile);
  const plans = names.map((target) =>
    planTarget({ target, file: TARGETS[target].file(env), servers, managed: state[target] ?? [] }),
  );
  if (check) {
    plans.forEach((plan) => log(`validated ${plan.file}`));
    return;
  }

  // Write each changed file, then persist which names dotagents now owns there
  for (const plan of plans) {
    if (plan.changed) {
      const backupPath = writePlanned(plan);
      if (backupPath) {
        log(`backup ${backupPath}`);
      }
      log(`updated ${plan.file}`);
    } else if (plan.current !== null) {
      log(`unchanged ${plan.file}`);
    }
    state[plan.target] = plan.names;
    const stateText = `${JSON.stringify(state, null, 2)}\n`;
    const stateCurrent = snapshot(stateFile);
    if (stateCurrent?.raw.toString("utf8") !== stateText) {
      writePlanned({ file: stateFile, current: stateCurrent, text: stateText }, { backup: false });
    }
  }
}
