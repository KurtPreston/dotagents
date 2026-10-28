// Apply a strict JSON settings overlay to an app's settings file, editing only overlay keys.
import fs from "node:fs";
import { setProperty } from "./lib/edit.ts";
import { replaceFile, snapshot } from "./lib/files.ts";
import type { Snapshot } from "./lib/files.ts";
import { InstallError, canonical, decodeUtf8, isObject, parseDocument } from "./lib/json.ts";
import type { JsonObject } from "./lib/json.ts";

export interface SettingsPlan {
  file: string;
  current: Snapshot | null;
  text: string;
  changed: boolean;
}

// Describe a key path the way error messages show it, such as $["outer"]["managed"]
function keyPath(keys: string[]): string {
  return `$${keys.map((key) => `[${JSON.stringify(key)}]`).join("")}`;
}

// Overlay objects merge recursively; anything else replaces the value, and nothing is deleted
function mergeEdits(
  text: string,
  { base, overlay }: { base: JsonObject; overlay: JsonObject },
  keys: string[] = [],
): string {
  let result = text;
  for (const [key, value] of Object.entries(overlay)) {
    const at = [...keys, key];
    const has = Object.hasOwn(base, key);
    if (isObject(value)) {
      // An overlay object can only merge into an object, or create one
      const existing = base[key];
      if (has && !isObject(existing)) {
        throw new InstallError(`object conflicts with non-object at ${keyPath(at)}`);
      }
      result =
        has && isObject(existing)
          ? mergeEdits(result, { base: existing, overlay: value }, at)
          : setProperty(result, at, value);
    } else if (!has || canonical(base[key]) !== canonical(value)) {
      // canonical() keeps true and 1 distinct, unlike loose equality
      result = setProperty(result, at, value);
    }
  }
  return result;
}

// Fold one overlay into the merged result, recording which file set each new key.
// A key two files set to different values is a conflict.
function combine(
  { into, from, file }: { into: JsonObject; from: JsonObject; file: string },
  owners: Map<string, string>,
  keys: string[] = [],
): void {
  for (const [key, value] of Object.entries(from)) {
    const at = [...keys, key];
    const existing = into[key];
    if (!Object.hasOwn(into, key)) {
      into[key] = structuredClone(value);
      owners.set(keyPath(at), file);
    } else if (isObject(existing) && isObject(value)) {
      combine({ into: existing, from: value, file }, owners, at);
    } else if (canonical(existing) !== canonical(value)) {
      // The owner is whichever file first set this key or an object above it
      const owner = at.map((_, depth) => owners.get(keyPath(at.slice(0, depth + 1)))).find(Boolean);
      throw new InstallError(
        `${file} sets ${keyPath(at)} differently than ${owner} — remove it from one of them`,
      );
    }
  }
}

// Read strict JSON overlays and merge them in order into one
export function mergeOverlays(files: string[]): JsonObject {
  const merged: JsonObject = {};
  const owners = new Map<string, string>();
  for (const file of files) {
    const overlay = parseDocument(decodeUtf8(fs.readFileSync(file), file), { label: file }).value;
    combine({ into: merged, from: overlay, file }, owners);
  }
  return merged;
}

// Read and check every document, then work out the edited destination without writing
export function planSettings(
  overlayFiles: string[],
  file: string,
  { jsonc = false }: { jsonc?: boolean } = {},
): SettingsPlan {
  const overlay = mergeOverlays(overlayFiles);
  const current = snapshot(file);
  const text = current === null ? "{}\n" : decodeUtf8(current.raw, file);
  const base = parseDocument(text, { label: file, jsonc }).value;

  // Prefix merge conflicts with the file they're in
  let edited: string;
  try {
    edited = mergeEdits(text, { base, overlay });
  } catch (error) {
    if (error instanceof InstallError) {
      throw new InstallError(`${file}: ${error.message}`);
    }
    throw error;
  }
  return { file, current, text: edited, changed: current === null || edited !== text };
}

// Apply an overlay, or only validate it with check, logging what happened
export function applySettings(
  overlayFiles: string[],
  file: string,
  {
    check = false,
    jsonc = false,
    log = console.log,
  }: {
    check?: boolean;
    jsonc?: boolean;
    log?: (line: string) => void;
  } = {},
): void {
  const plan = planSettings(overlayFiles, file, { jsonc });
  if (check) {
    log(`validated ${file}`);
    return;
  }
  if (!plan.changed) {
    log(`unchanged ${file}`);
    return;
  }
  const backupPath = replaceFile(plan);
  if (backupPath) {
    log(`backup ${backupPath}`);
  }
  log(`updated ${file}`);
}
