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

// Read and check both documents, then work out the edited destination without writing
export function planSettings(overlayFile: string, file: string): SettingsPlan {
  const overlayText = decodeUtf8(fs.readFileSync(overlayFile), overlayFile);
  const overlay = parseDocument(overlayText, { label: overlayFile }).value;
  const current = snapshot(file);
  const text = current === null ? "{}\n" : decodeUtf8(current.raw, file);
  const base = parseDocument(text, { label: file }).value;

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
  overlayFile: string,
  file: string,
  { check = false, log = console.log }: { check?: boolean; log?: (line: string) => void } = {},
): void {
  const plan = planSettings(overlayFile, file);
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
