#!/usr/bin/env python3
"""Apply a strict JSON object overlay without taking ownership of the whole file."""

import argparse
import json
import math
import os
from pathlib import Path
import stat
import sys
import tempfile


class SettingsError(ValueError):
    pass


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise SettingsError("duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise SettingsError("nonstandard JSON numeric constant")


def finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise SettingsError("JSON number exceeds supported range")
    return number


def parse_document(raw, path):
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs,
                              parse_constant=reject_constant, parse_float=finite_float)
    except (ValueError, UnicodeError) as error:
        # Do not expose configuration values in parsing errors.
        raise SettingsError("{}: invalid or ambiguous JSON".format(path)) from error
    if not isinstance(document, dict):
        raise SettingsError("{}: JSON root must be an object".format(path))
    return document


def merge(base, overlay, path="$"):
    result = base.copy()
    for key, value in overlay.items():
        key_path = "{}[{}]".format(path, json.dumps(key))
        if isinstance(value, dict):
            if key in base and not isinstance(base[key], dict):
                raise SettingsError("object conflicts with non-object at " + key_path)
            result[key] = merge(base.get(key, {}), value, key_path)
        else:
            result[key] = value
    return result


def snapshot(path):
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(metadata.st_mode):
        raise SettingsError("{}: destination must be a regular file, not a symlink".format(path))

    # Reject links swapped in between the metadata check and open.
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if not stat.S_ISREG(opened.st_mode):
            raise SettingsError("{}: destination changed while reading".format(path))
        raw = stream.read()
    identity = (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                opened.st_ctime_ns, opened.st_mode, opened.st_uid, opened.st_gid)
    return raw, identity


def stage_file(target, raw, mode, suffix):
    fd, name = tempfile.mkstemp(prefix=target.name + ".", suffix=suffix,
                                dir=str(target.parent))
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
    except BaseException:
        temporary.unlink()
        raise
    return temporary


def apply_settings(overlay_path, target, check=False):
    overlay_path, target = Path(overlay_path), Path(target)
    overlay = parse_document(overlay_path.read_bytes(), overlay_path)
    original = snapshot(target)
    base = parse_document(original[0], target) if original is not None else {}
    result = merge(base, overlay)

    # JSON comparison distinguishes booleans from numbers, unlike Python equality.
    canonical = lambda value: json.dumps(value, sort_keys=True, allow_nan=False)
    changed = original is None or canonical(base) != canonical(result)
    if check:
        print("validated {}".format(target))
        return
    if not changed:
        print("unchanged {}".format(target))
        return

    # Fully serialize before creating directories or backups.
    raw = (json.dumps(result, indent=2, ensure_ascii=True, allow_nan=False) + "\n").encode("utf-8")
    mode = stat.S_IMODE(original[1][5]) if original else 0o600
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = stage_file(target, raw, mode, ".tmp")
    try:
        if snapshot(target) != original:
            raise SettingsError("{}: destination changed; retry installation".format(target))
        if original is not None:
            backup = stage_file(target, original[0], 0o600, ".bak")
            print("backup {}".format(backup))
        # This check reduces lost updates; it cannot lock out application writes.
        if snapshot(target) != original:
            raise SettingsError("{}: destination changed; retry installation".format(target))
        os.replace(str(temporary), str(target))
    finally:
        if temporary.exists():
            temporary.unlink()
    print("updated {}".format(target))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing")
    parser.add_argument("overlay", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    try:
        apply_settings(args.overlay, args.destination, check=args.check)
    except (OSError, ValueError, RecursionError) as error:
        print("error: {}".format(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
