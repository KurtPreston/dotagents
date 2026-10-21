// Parse JSON and JSONC documents strictly enough to edit them safely.
import { getNodeValue, parseTree, printParseErrorCode } from "jsonc-parser";
import type { Node, ParseError } from "jsonc-parser";

// Errors the installer reports as "error: <message>" without a stack trace
export class InstallError extends Error {}

export type JsonObject = Record<string, unknown>;

export interface ParsedDocument {
  tree: Node;
  value: JsonObject;
}

// Reject duplicate keys and out-of-range numbers anywhere in the tree
function assertUnambiguous(node: Node, label: string): void {
  if (node.type === "number" && !Number.isFinite(node.value)) {
    throw new InstallError(`${label}: invalid JSON (number out of range)`);
  }
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value as string;
      if (seen.has(key)) {
        throw new InstallError(`${label}: duplicate JSON key`);
      }
      seen.add(key);
    }
  }
  for (const child of node.children ?? []) {
    assertUnambiguous(child, label);
  }
}

// Decode bytes as UTF-8, rejecting invalid sequences instead of replacing them
export function decodeUtf8(raw: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new InstallError(`${label}: invalid JSON (not UTF-8)`);
  }
}

// Parse text into a syntax tree and value; JSONC allows comments and trailing commas
export function parseDocument(
  text: string,
  { jsonc = false, label }: { jsonc?: boolean; label: string },
): ParsedDocument {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    disallowComments: !jsonc,
    allowTrailingComma: jsonc,
    allowEmptyContent: false,
  });

  // Report syntax errors by position only, never by value
  if (errors.length > 0 || tree === undefined) {
    const first = errors[0];
    const detail = first ? ` (${printParseErrorCode(first.error)} at offset ${first.offset})` : "";
    throw new InstallError(`${label}: invalid JSON${detail}`);
  }
  if (tree.type !== "object") {
    throw new InstallError(`${label}: JSON root must be an object`);
  }
  assertUnambiguous(tree, label);

  // getNodeValue builds prototype-less objects; round-trip to ordinary ones
  return { tree, value: JSON.parse(JSON.stringify(getNodeValue(tree))) as JsonObject };
}

// True for a plain JSON object, as opposed to an array, null, or a scalar
export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Serialize with sorted object keys, so key order never affects comparison
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    isObject(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((name) => [name, item[name]]),
        )
      : item,
  );
}
