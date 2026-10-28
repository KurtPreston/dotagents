// Find executables the way a shell would.
import fs from "node:fs";
import path from "node:path";

// True when a path is a regular file this process may execute
export function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// The first executable named command in searchPath's absolute directories
export function findOnPath(command: string, searchPath: string | undefined): string | undefined {
  return (searchPath ?? "")
    .split(path.delimiter)
    .filter((dir) => path.isAbsolute(dir))
    .map((dir) => path.join(dir, command))
    .find(isExecutableFile);
}
