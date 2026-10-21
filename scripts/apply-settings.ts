// Temporary entry point so install.sh can apply settings until the installer is TypeScript.
// Usage: node apply-settings.ts [--check] <overlay> <destination>
import { InstallError } from "./lib/json.ts";
import { applySettings } from "./settings.ts";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const [overlay, destination, ...extra] = check ? args.slice(1) : args;

try {
  if (overlay === undefined || destination === undefined || extra.length > 0) {
    throw new InstallError("usage: apply-settings.ts [--check] <overlay> <destination>");
  }
  applySettings(overlay, destination, { check });
} catch (error) {
  // Filesystem errors carry paths but not configuration values
  if (error instanceof InstallError || (error as NodeJS.ErrnoException).code) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
  throw error;
}
