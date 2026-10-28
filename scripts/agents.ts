// The agents dotagents installs into, and which of them are installed on this machine.
import fs from "node:fs";
import path from "node:path";
import { findOnPath } from "./lib/path.ts";

export const TARGET_NAMES = ["cursor", "zed", "claude", "copilot"] as const;
export type Target = (typeof TARGET_NAMES)[number];

// What shows an agent is installed: a command on PATH, or a macOS app bundle. Config
// folders don't count, since earlier installs may have created them.
const SIGNS: Record<Target, { commands: string[]; apps: string[] }> = {
  cursor: { commands: ["cursor"], apps: ["Cursor.app"] },
  zed: { commands: ["zed", "zeditor"], apps: ["Zed.app"] },
  // The Claude desktop app runs Claude Code too, sharing ~/.claude
  claude: { commands: ["claude"], apps: ["Claude.app"] },
  // VS Code's Copilot agent shares ~/.copilot with Copilot CLI
  copilot: {
    commands: ["copilot", "code", "code-insiders"],
    apps: ["Visual Studio Code.app", "Visual Studio Code - Insiders.app"],
  },
};

// Folders holding app bundles: DOTAGENTS_APP_DIRS when set, else the macOS defaults
export function appDirs(env: NodeJS.ProcessEnv): string[] {
  if (env.DOTAGENTS_APP_DIRS !== undefined) {
    return env.DOTAGENTS_APP_DIRS.split(path.delimiter).filter(Boolean);
  }
  if (process.platform !== "darwin") {
    return [];
  }
  return ["/Applications", ...(env.HOME ? [path.join(env.HOME, "Applications")] : [])];
}

// Every agent with a command on searchPath or an app bundle in one of apps
export function detectAgents({
  searchPath,
  apps,
}: {
  searchPath: string | undefined;
  apps: string[];
}): Target[] {
  return TARGET_NAMES.filter((target) => {
    const { commands, apps: bundles } = SIGNS[target];
    return (
      commands.some((command) => findOnPath(command, searchPath)) ||
      apps.some((dir) => bundles.some((bundle) => fs.existsSync(path.join(dir, bundle))))
    );
  });
}
