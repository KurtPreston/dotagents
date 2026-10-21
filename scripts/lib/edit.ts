// Edit one property of a JSON or JSONC document while leaving every other line as it was.
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";
import type { Node } from "jsonc-parser";

const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };
const PARSE = { allowTrailingComma: true };

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

// Wrap a value in objects for the keys below an existing ancestor: ["a", "b"], 1 -> {b: 1} under "a"
function nest(keys: string[], value: unknown): { name: string; value: unknown } {
  const [name = "", ...rest] = keys;
  return { name, value: rest.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) };
}

// Set or remove the property at a path, touching as little text as possible.
// Passing undefined removes it. Ancestors that don't exist yet are created.
export function setProperty(text: string, keys: string[], value: unknown): string {
  const root = parseTree(text, [], PARSE);
  const existing = root && findNodeAtLocation(root, keys);
  if (value === undefined) {
    const container = existing?.parent?.parent;
    if (!existing?.parent || !container) {
      return text;
    }
    const removed = removeProperty(text, container, existing.parent);
    return removed ?? applyEdits(text, modify(text, keys, undefined, {}));
  }

  // New properties go after the last sibling of their deepest existing ancestor
  if (root && !existing) {
    let depth = keys.length - 1;
    while (depth > 0 && !findNodeAtLocation(root, keys.slice(0, depth))) {
      depth -= 1;
    }
    const parent = depth === 0 ? root : findNodeAtLocation(root, keys.slice(0, depth));
    if (parent?.type === "object" && parent.children?.length) {
      const appended = appendProperty(text, parent, nest(keys.slice(depth), value));
      if (appended !== null) {
        return appended;
      }
    }
  }

  // Replacements, empty objects, and one-line files are safe to let jsonc-parser format
  return applyEdits(text, modify(text, keys, value, FORMAT));
}
