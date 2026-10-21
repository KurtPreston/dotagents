// Parse JSON and JSONC documents strictly enough to edit them safely.
import { getNodeValue, parseTree, printParseErrorCode } from "jsonc-parser";
import type { Node, ParseError } from "jsonc-parser";

export class McpError extends Error {}

export type JsonObject = Record<string, unknown>;

export interface ParsedDocument {
  tree: Node;
  value: JsonObject;
}

// Reject duplicate keys anywhere, since editors and apps disagree on which one wins
function assertUniqueKeys(node: Node, label: string): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value as string;
      if (seen.has(key)) {
        throw new McpError(`${label}: duplicate JSON key`);
      }
      seen.add(key);
    }
  }
  for (const child of node.children ?? []) {
    assertUniqueKeys(child, label);
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
    throw new McpError(`${label}: invalid JSON${detail}`);
  }
  if (tree.type !== "object") {
    throw new McpError(`${label}: JSON root must be an object`);
  }
  assertUniqueKeys(tree, label);

  // getNodeValue builds prototype-less objects; round-trip to ordinary ones
  return { tree, value: JSON.parse(JSON.stringify(getNodeValue(tree))) as JsonObject };
}
