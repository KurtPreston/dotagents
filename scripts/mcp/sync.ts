// Apply declared MCP servers to agent config files with safe, minimal edits.
import path from "node:path";
import { setProperty } from "../lib/edit.ts";
import { replaceFile, snapshot } from "../lib/files.ts";
import type { Snapshot } from "../lib/files.ts";
import { InstallError, decodeUtf8, isObject, parseDocument } from "../lib/json.ts";
import type { JsonObject } from "../lib/json.ts";
import { TARGETS, isTargetName, sameEntry } from "./targets.ts";
import type { Homes, Server, Target, TargetName } from "./targets.ts";
import { parseToml, setTomlServer } from "./toml.ts";

// Set or remove one server under a top-level key
export function setServer(text: string, [key, name]: [string, string], value: unknown): string {
  return setProperty(text, [key, name], value);
}

type State = Partial<Record<TargetName, string[]>>;

// Read the per-target list of server names dotagents installed
export function readState(file: string): State {
  const current = snapshot(file);
  if (current === null) {
    return {};
  }
  const { value } = parseDocument(decodeUtf8(current.raw, file), { label: file });
  for (const [target, names] of Object.entries(value)) {
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
      throw new InstallError(`${file}: "${target}" must be an array of server names`);
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

// Read a config's servers map, and edit one server, in the target's file format
function formatOf(target: Target, file: string) {
  if (target.format === "toml") {
    return {
      empty: "",
      read: (text: string) => parseToml(text, file),
      set: (text: string, name: string, value: unknown) =>
        setTomlServer(text, [target.key, name], {
          value: value as JsonObject | undefined,
          label: file,
        }),
    };
  }
  return {
    empty: "{}\n",
    read: (text: string) =>
      parseDocument(text, { jsonc: target.format === "jsonc", label: file }).value,
    set: (text: string, name: string, value: unknown) => setServer(text, [target.key, name], value),
  };
}

// Work out the edited text for one target without touching the disk
export function planTarget({ target: targetName, file, servers, managed }: PlanInput): Plan {
  const target = TARGETS[targetName];
  const format = formatOf(target, file);
  const current = snapshot(file);
  let text = current === null ? format.empty : decodeUtf8(current.raw, file);
  const value = format.read(text);

  // The servers map must be an object if it exists
  const entries = value[target.key] ?? {};
  if (!isObject(entries)) {
    throw new InstallError(`${file}: "${target.key}" must be an object`);
  }
  const edit = (name: string, entry: unknown) => {
    text = format.set(text, name, entry);
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
      throw new InstallError(
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
  const changed = current === null ? declared.size > 0 : text !== decodeUtf8(current.raw, file);
  return { target: targetName, file, current, text, changed, names: [...declared].sort() };
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
      throw new InstallError(
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
      const backupPath = replaceFile(plan);
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
      replaceFile({ file: stateFile, current: stateCurrent, text: stateText }, { backup: false });
    }
  }
}
