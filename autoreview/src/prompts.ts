import { readFileSync } from "node:fs";
import type { Config } from "./config.ts";
import type { PullRequest } from "./forge.ts";

const PROMPTS = new URL("../prompts/", import.meta.url);

/** Fill a prompt template's `{{name}}` slots in one pass, so filled text is never re-read. */
export function render(name: string, vars: Record<string, string | number>): string {
  const template = readFileSync(new URL(`${name}.md`, PROMPTS), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`prompt ${name} needs {{${key}}}`);
    }
    return String(vars[key]);
  });
}

/** The shared preamble: the deliberation's rules, the project, and the pull request. */
export function common(pr: PullRequest, config: Config): string {
  return render("common", {
    visualNote: config.visual ? "" : ", since visual checks aren't available here",
    context: config.context.map((path) => `\`${path}\``).join(", "),
    number: pr.number,
    title: pr.title,
    author: pr.author,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    body: pr.body.trim() || "(no description)",
  });
}

/** Cut text that would crowd an agent's context, saying how to read the rest. */
export function clip(text: string, limit: number, rest: string): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n… (cut at ${limit} characters; ${rest})`;
}
