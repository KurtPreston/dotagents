// Read TOML configs, and add, replace, or remove one server table with minimal edits.
import { parse } from "smol-toml";
import { InstallError, canonical, isObject } from "../lib/json.ts";
import type { JsonObject } from "../lib/json.ts";

// Parse a TOML document into plain objects, reporting errors by position only
export function parseToml(text: string, label: string): JsonObject {
  try {
    return JSON.parse(JSON.stringify(parse(text))) as JsonObject;
  } catch (error) {
    const { line, column } = error as { line?: number; column?: number };
    const at = line === undefined ? "" : ` at line ${line}, column ${column}`;
    throw new InstallError(`${label}: invalid TOML${at}`);
  }
}

// Render a JSON value as an inline TOML value. JSON string escapes are valid TOML, except
// that TOML also requires escaping DEL.
function tomlValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (isObject(value)) {
    const pairs = Object.entries(value).map(
      ([key, item]) => `${tomlValue(key)} = ${tomlValue(item)}`,
    );
    return pairs.length === 0 ? "{}" : `{ ${pairs.join(", ")} }`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value).replaceAll("\x7f", "\\u007F");
  }
  return String(value);
}

// Render one server as a [key.name] table, one line per field
function renderTable([key, name]: [string, string], value: JsonObject): string[] {
  return [
    `[${key}.${name}]`,
    ...Object.entries(value).map(([field, item]) => `${field} = ${tomlValue(item)}`),
  ];
}

// True for a table header line naming key.name or one of its subtables
function isServerHeader(line: string, [key, name]: [string, string]): boolean {
  const match = /^\s*\[\s*([^[\]]+?)\s*\]\s*(#.*)?$/.exec(line);
  const parts = match?.[1]?.split(".").map((part) => part.trim().replace(/^(["'])(.*)\1$/, "$2"));
  return parts !== undefined && parts[0] === key && parts[1] === name;
}

const isHeader = (line: string) => /^\s*\[/.test(line);

// Set key.name to value, or remove it when value is undefined. The server's tables are
// replaced in place or appended; every other line is kept. The result is parsed again, and
// anything but the intended change, such as a server written as dotted keys, is refused.
export function setTomlServer(
  text: string,
  [key, name]: [string, string],
  { value, label }: { value: JsonObject | undefined; label: string },
): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let at = -1;
  let inServer = false;
  for (const line of lines) {
    if (isHeader(line)) {
      inServer = isServerHeader(line, [key, name]);
      if (inServer && at === -1) {
        at = kept.length;
      }
    }
    if (!inServer) {
      kept.push(line);
    }
  }

  // Insert the table where it was, or after the last line, separated by a blank line
  if (value !== undefined) {
    const table = renderTable([key, name], value);
    if (at === -1) {
      while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") {
        kept.pop();
      }
      kept.push(...(kept.length > 0 ? [""] : []), ...table, "");
    } else {
      kept.splice(at, 0, ...table, "");
    }
  }
  const result = kept.join("\n");

  // Check that exactly this server changed; removing the last one may drop the key itself
  const expected = parseToml(text, label);
  const servers = isObject(expected[key]) ? expected[key] : {};
  if (value === undefined) {
    delete servers[name];
  } else {
    servers[name] = value;
  }
  expected[key] = servers;
  let actual: JsonObject | undefined;
  try {
    actual = parseToml(result, label);
  } catch {
    actual = undefined;
  }
  if (actual && Object.keys(servers).length === 0 && !Object.hasOwn(actual, key)) {
    delete expected[key];
  }
  if (actual === undefined || canonical(actual) !== canonical(expected)) {
    throw new InstallError(
      `${label}: couldn't edit the "${name}" server in "${key}" — write it as a [${key}.${name}] table, or remove it, then rerun`,
    );
  }
  return result;
}
