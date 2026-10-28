// Read and replace config files safely: no symlinks, owner-only backups, atomic swaps.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { InstallError } from "./json.ts";

export interface Snapshot {
  raw: Buffer;
  identity: string;
  mode: number;
}

// Read a regular file without following links, with an identity to detect later changes
export function snapshot(file: string): Snapshot | null {
  let metadata: fs.Stats;
  try {
    metadata = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!metadata.isFile()) {
    const detail = metadata.isSymbolicLink() ? ", not a symlink" : "";
    throw new InstallError(`${file}: destination must be a regular file${detail}`);
  }

  // Reject links swapped in between the metadata check and open
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const raw = fs.readFileSync(fd);
    const identity = [
      opened.dev,
      opened.ino,
      opened.size,
      opened.mtimeNs,
      opened.ctimeNs,
      opened.mode,
      opened.uid,
      opened.gid,
    ].join(":");
    return { raw, identity, mode: Number(opened.mode) & 0o777 };
  } finally {
    fs.closeSync(fd);
  }
}

// Write bytes to a uniquely named sibling file with the given permissions
export function stageFile(
  target: string,
  raw: string | Uint8Array,
  { mode, suffix }: { mode: number; suffix: string },
): string {
  const name = `${target}.${crypto.randomBytes(6).toString("hex")}${suffix}`;
  const fd = fs.openSync(name, "wx", mode);
  try {
    fs.writeFileSync(fd, raw);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(name, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  return name;
}

export interface Replacement {
  file: string;
  current: Snapshot | null;
  text: string;
}

// Replace a file atomically, backing up the original and refusing concurrent changes
export function replaceFile(
  { file, current, text }: Replacement,
  { backup = true }: { backup?: boolean } = {},
): string | null {
  const mode = current ? current.mode : 0o600;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = stageFile(file, text, { mode, suffix: ".tmp" });
  let backupPath: string | null = null;
  try {
    const unchanged = () => (snapshot(file)?.identity ?? null) === (current?.identity ?? null);
    if (!unchanged()) {
      throw new InstallError(`${file}: destination changed; retry installation`);
    }

    // Keep the exact original bytes, owner-only, before replacing
    if (current !== null && backup) {
      backupPath = stageFile(file, current.raw, { mode: 0o600, suffix: ".bak" });
    }
    if (!unchanged()) {
      throw new InstallError(`${file}: destination changed; retry installation`);
    }
    fs.renameSync(temporary, file);
    return backupPath;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
