// Tests for applying settings overlays: merge rules, strict parsing, and safe writes.
import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySettings } from "../scripts/settings.ts";

// Temporary overlay and destination, with helpers to apply and inspect them
function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dotagents-settings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const overlay = path.join(root, "overlay.json");
  fs.writeFileSync(overlay, '{"managed": true}');
  const state = { root, overlay, target: path.join(root, "settings.json") };

  // Apply with captured output; read entries, backups, and leftover temporaries
  const apply = (options: { check?: boolean } = {}) => {
    const lines: string[] = [];
    applySettings(state.overlay, state.target, { ...options, log: (line) => lines.push(line) });
    return lines.join("\n");
  };
  const entries = () => fs.readdirSync(root).sort();
  const backups = () => entries().filter((name) => /^settings\.json\..*\.bak$/.test(name));
  const temporaries = () =>
    fs.readdirSync(root, { recursive: true }).filter((name) => String(name).endsWith(".tmp"));
  return { ...state, state, apply, entries, backups, temporaries };
}

type Fixture = ReturnType<typeof fixture>;

// A rejected apply must leave every directory entry and the destination untouched
function assertRejected(f: Fixture, pattern: RegExp) {
  const before = f.entries();
  const exists = fs.existsSync(f.state.target);
  const bytes = exists ? fs.readFileSync(f.state.target) : null;
  const mtime = exists ? fs.statSync(f.state.target, { bigint: true }).mtimeNs : null;
  assert.throws(() => f.apply(), pattern);
  assert.deepEqual(f.entries(), before);
  if (bytes !== null) {
    assert.deepEqual(fs.readFileSync(f.state.target), bytes);
    assert.equal(fs.statSync(f.state.target, { bigint: true }).mtimeNs, mtime);
  } else {
    assert.ok(!fs.existsSync(f.state.target));
  }
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const mode = (file: string) => fs.statSync(file).mode & 0o777;

test("nested objects merge and undeclared values survive", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    f.target,
    JSON.stringify({
      attribution: { commit: "old", pr: "old", local: "keep" },
      permissions: { allow: ["read"] },
      plugins: ["local"],
    }),
  );
  fs.writeFileSync(
    f.overlay,
    JSON.stringify({ attribution: { commit: "", pr: "" }, new: { nested: { enabled: true } } }),
  );
  f.apply();
  assert.deepEqual(readJson(f.target), {
    attribution: { commit: "", pr: "", local: "keep" },
    permissions: { allow: ["read"] },
    plugins: ["local"],
    new: { nested: { enabled: true } },
  });
});

test("scalars, arrays, and null replace values instead of deleting them", (t) => {
  const f = fixture(t);
  const overlay = {
    text: "new",
    number: 2,
    flag: false,
    array: [3],
    object: "replacement",
    null: null,
    new_null: null,
  };
  fs.writeFileSync(
    f.target,
    JSON.stringify({
      text: "old",
      number: 1,
      flag: true,
      array: [1, 2],
      object: { keep: false },
      null: { old: true },
    }),
  );
  fs.writeFileSync(f.overlay, JSON.stringify(overlay));
  f.apply();
  assert.deepEqual(readJson(f.target), overlay);
});

test("only overlay keys change; other formatting survives byte for byte", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    f.target,
    '{\n    "local" : [1,2],\n    "managed": false,\n    "other":{"x":1}\n}\n',
  );
  f.apply();
  assert.equal(
    fs.readFileSync(f.target, "utf8"),
    '{\n    "local" : [1,2],\n    "managed": true,\n    "other":{"x":1}\n}\n',
  );

  // New keys are added after the last one, at the same indentation
  fs.writeFileSync(f.overlay, '{"other": {"y": 2}}');
  f.apply();
  assert.deepEqual(readJson(f.target), { local: [1, 2], managed: true, other: { x: 1, y: 2 } });
  assert.ok(fs.readFileSync(f.target, "utf8").startsWith('{\n    "local" : [1,2],\n'));
});

test("an object over a non-object fails and names the nested key path", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.overlay, '{"outer": {"managed": {}}}');
  for (const value of [null, false, 0, "local", [1]]) {
    fs.writeFileSync(f.target, JSON.stringify({ outer: { managed: value } }));
    assertRejected(f, /object conflicts with non-object at \$\["outer"\]\["managed"\]/);
  }
});

test("a missing destination is created with parents, owner-only", (t) => {
  const f = fixture(t);
  f.state.target = path.join(f.root, "missing", "nested", "settings.json");
  const output = f.apply();
  assert.equal(fs.readFileSync(f.state.target, "utf8"), '{\n  "managed": true\n}\n');
  assert.equal(mode(f.state.target), 0o600);
  assert.match(output, new RegExp(`updated ${f.state.target}`));
  assert.deepEqual(f.temporaries(), []);

  // An empty overlay still creates the file
  fs.writeFileSync(f.overlay, "{}");
  f.state.target = path.join(f.root, "empty.json");
  f.apply();
  assert.equal(fs.readFileSync(f.state.target, "utf8"), "{}\n");
});

test("a missing overlay fails without creating the destination", (t) => {
  const f = fixture(t);
  fs.rmSync(f.overlay);
  assert.throws(() => f.apply(), { code: "ENOENT" });
  assert.deepEqual(f.entries(), []);
});

test("invalid or ambiguous JSON in either document is rejected", async (t) => {
  const invalid = [
    "",
    " \n\t",
    '{"secret":',
    '{"a": 1,}',
    '{"a": 1, "a": 2}',
    '{"nested": {"a": 1, "a": 2}}',
    '{"value": NaN}',
    '{"value": Infinity}',
    '{"value": -Infinity}',
    '{"value": 1e999}',
    '{"a": 1} // comment',
  ].map((text) => Buffer.from(text));
  invalid.push(Buffer.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]));
  for (const document of ["overlay", "target"] as const) {
    for (const raw of invalid) {
      await t.test(`${document}: ${JSON.stringify(raw.toString("latin1"))}`, (t) => {
        const f = fixture(t);
        fs.writeFileSync(f.target, '{"local": "keep"}');
        fs.writeFileSync(f[document], raw);
        assertRejected(f, /invalid JSON|duplicate JSON key/);
      });
    }
  }
});

test("non-object roots in either document are rejected", async (t) => {
  for (const document of ["overlay", "target"] as const) {
    for (const raw of ["[]", "null", "true", "1", '"text"']) {
      await t.test(`${document}: ${raw}`, (t) => {
        const f = fixture(t);
        fs.writeFileSync(f.target, '{"local": "keep"}');
        fs.writeFileSync(f[document], raw);
        assertRejected(f, /JSON root must be an object/);
      });
    }
  }
});

test("an invalid overlay doesn't create parent folders", (t) => {
  const f = fixture(t);
  f.state.target = path.join(f.root, "absent", "settings.json");
  fs.writeFileSync(f.overlay, '{"duplicate": 1, "duplicate": 2}');
  assertRejected(f, /duplicate JSON key/);
  assert.ok(!fs.existsSync(path.dirname(f.state.target)));
});

test("symlinked and dangling destinations are refused", async (t) => {
  for (const dangling of [false, true]) {
    await t.test(`dangling: ${dangling}`, (t) => {
      const f = fixture(t);
      const referent = path.join(f.root, "referent.json");
      if (!dangling) {
        fs.writeFileSync(referent, '{"local": "keep"}');
      }
      fs.symlinkSync(referent, f.target);
      assert.throws(() => f.apply(), /regular file, not a symlink/);
      assert.equal(fs.readlinkSync(f.target), referent);
      assert.equal(fs.existsSync(referent), !dangling);
      assert.deepEqual(f.backups(), []);
      assert.deepEqual(f.temporaries(), []);
    });
  }
});

test("a directory destination is refused", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.target);
  assert.throws(() => f.apply(), /must be a regular file/);
  assert.deepEqual(fs.readdirSync(f.target), []);
  assert.deepEqual(f.backups(), []);
});

test("backups hold the exact original bytes, owner-only, and are never overwritten", (t) => {
  const f = fixture(t);
  const original = Buffer.from('{ "local" : "caf\u00e9", "managed" : false }\r\n');
  fs.writeFileSync(f.target, original);
  fs.chmodSync(f.target, 0o640);
  const output = f.apply();
  const [first = ""] = f.backups();
  assert.deepEqual(fs.readFileSync(path.join(f.root, first)), original);
  assert.equal(mode(path.join(f.root, first)), 0o600);
  assert.equal(mode(f.target), 0o640);
  assert.match(output, new RegExp(`backup ${path.join(f.root, first)}`));
  assert.doesNotMatch(output, /caf/);

  // A second update keeps the first backup and adds another
  const intermediate = fs.readFileSync(f.target);
  fs.writeFileSync(f.overlay, '{"managed": false}');
  f.apply();
  const second = f.backups().find((name) => name !== first) ?? "";
  assert.equal(f.backups().length, 2);
  assert.deepEqual(fs.readFileSync(path.join(f.root, first)), original);
  assert.deepEqual(fs.readFileSync(path.join(f.root, second)), intermediate);
  assert.deepEqual(f.temporaries(), []);
});

test("an unchanged file keeps its bytes, metadata, and inode", (t) => {
  const f = fixture(t);
  const original = Buffer.from('{ "local": 3, "managed" : true }\r\n');
  fs.writeFileSync(f.target, original);
  fs.chmodSync(f.target, 0o640);
  const before = fs.statSync(f.target, { bigint: true });
  const opened = t.mock.method(fs, "openSync");
  const output = f.apply();
  assert.ok(opened.mock.calls.every((call) => !String(call.arguments[0]).match(/\.(tmp|bak)$/)));
  const after = fs.statSync(f.target, { bigint: true });
  assert.deepEqual(fs.readFileSync(f.target), original);
  assert.deepEqual(
    [after.ino, after.mode, after.mtimeNs, after.ctimeNs],
    [before.ino, before.mode, before.mtimeNs, before.ctimeNs],
  );
  assert.match(output, new RegExp(`unchanged ${f.target}`));
});

test("reapplying is idempotent, and keys removed from the overlay are kept", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.target, '{"local": 1}');
  f.apply();
  const bytes = fs.readFileSync(f.target);
  const before = fs.statSync(f.target, { bigint: true });
  const backups = f.backups();
  for (const overlay of ['{"managed": true}', "{}"]) {
    fs.writeFileSync(f.overlay, overlay);
    assert.match(f.apply(), /unchanged/);
    assert.deepEqual(fs.readFileSync(f.target), bytes);
    assert.equal(fs.statSync(f.target, { bigint: true }).mtimeNs, before.mtimeNs);
    assert.deepEqual(f.backups(), backups);
  }
});

test("booleans and numbers are never treated as equal", (t) => {
  const f = fixture(t);
  const wraps = [(v: unknown) => v, (v: unknown) => [v], (v: unknown) => ({ value: v })];
  for (const [old, next] of [
    [true, 1],
    [1, true],
    [false, 0],
    [0, false],
  ]) {
    for (const wrap of wraps) {
      fs.writeFileSync(f.target, JSON.stringify({ managed: wrap(old) }));
      fs.writeFileSync(f.overlay, JSON.stringify({ managed: wrap(next) }));
      assert.match(f.apply(), /updated/);
      assert.equal(JSON.stringify(readJson(f.target)), JSON.stringify({ managed: wrap(next) }));
    }
  }
});

test("check mode validates without writing anything", async (t) => {
  for (const exists of [false, true]) {
    await t.test(`exists: ${exists}`, (t) => {
      const f = fixture(t);
      f.state.target = exists ? f.target : path.join(f.root, "absent", "settings.json");
      if (exists) {
        fs.writeFileSync(f.state.target, '{"local": true}');
      }
      const before = exists ? fs.statSync(f.state.target, { bigint: true }) : null;
      assert.match(f.apply({ check: true }), new RegExp(`validated ${f.state.target}`));
      if (before) {
        assert.equal(fs.readFileSync(f.state.target, "utf8"), '{"local": true}');
        assert.equal(fs.statSync(f.state.target, { bigint: true }).ctimeNs, before.ctimeNs);
      } else {
        assert.ok(!fs.existsSync(path.dirname(f.state.target)));
      }
      assert.deepEqual(f.backups(), []);
      assert.deepEqual(f.temporaries(), []);
    });
  }
});

test("errors name the file without exposing its values", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.target, '{"secret": "do-not-log",}');
  assert.throws(
    () => f.apply({ check: true }),
    (error: Error) => error.message.startsWith(f.target) && !error.message.includes("do-not-log"),
  );
  assert.deepEqual(f.backups(), []);
});

test("a failed backup aborts and cleans up the staged file", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.target, '{"local": "keep"}');
  const openSync = fs.openSync;
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    if (String(args[0]).endsWith(".bak")) {
      throw new Error("controlled backup failure");
    }
    return openSync(...args);
  });
  const renamed = t.mock.method(fs, "renameSync");
  assert.throws(() => f.apply(), /controlled backup failure/);
  assert.equal(renamed.mock.callCount(), 0);
  assert.equal(fs.readFileSync(f.target, "utf8"), '{"local": "keep"}');
  assert.deepEqual(f.entries(), ["overlay.json", "settings.json"]);
});

test("partial writes of the staged file or backup are cleaned up", async (t) => {
  for (const failOn of [1, 2]) {
    await t.test(failOn === 1 ? "output" : "backup", (t) => {
      const f = fixture(t);
      fs.writeFileSync(f.target, '{"local": "keep"}');
      const writeFileSync = fs.writeFileSync;
      let writes = 0;

      // Write a few bytes of the chosen staged file, then fail
      t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
        if (typeof args[0] === "number" && ++writes === failOn) {
          writeFileSync(args[0], String(args[1]).slice(0, 3));
          throw new Error("controlled partial write failure");
        }
        return writeFileSync(...args);
      });
      const renamed = t.mock.method(fs, "renameSync");
      assert.throws(() => f.apply(), /controlled partial write failure/);
      assert.equal(renamed.mock.callCount(), 0);
      assert.equal(fs.readFileSync(f.target, "utf8"), '{"local": "keep"}');
      assert.deepEqual(f.entries(), ["overlay.json", "settings.json"]);
    });
  }
});

test("a failed replace keeps the original and its exact backup", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.target, '{ "local": "keep" }\n');
  t.mock.method(fs, "renameSync", () => {
    throw new Error("controlled replace failure");
  });
  assert.throws(() => f.apply(), /controlled replace failure/);
  assert.equal(fs.readFileSync(f.target, "utf8"), '{ "local": "keep" }\n');
  const [backup = ""] = f.backups();
  assert.equal(fs.readFileSync(path.join(f.root, backup), "utf8"), '{ "local": "keep" }\n');
  assert.equal(mode(path.join(f.root, backup)), 0o600);
  assert.deepEqual(f.temporaries(), []);
});

// Write `concurrent` to the destination right after a staged file with the suffix is closed
function changeAfterStaging(
  t: TestContext,
  { target, suffix, concurrent }: { target: string; suffix: string; concurrent: string },
) {
  const { openSync, closeSync } = fs;
  const names = new Map<number, string>();
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const fd = openSync(...args);
    names.set(fd, String(args[0]));
    return fd;
  });
  t.mock.method(fs, "closeSync", (fd: number) => {
    closeSync(fd);
    if (names.get(fd)?.endsWith(suffix)) {
      fs.writeFileSync(target, concurrent);
    }
  });
}

test("a destination changed during the write is not replaced", async (t) => {
  for (const suffix of [".tmp", ".bak"]) {
    await t.test(`after ${suffix}`, (t) => {
      const f = fixture(t);
      fs.writeFileSync(f.target, '{"local": "original"}');
      changeAfterStaging(t, { target: f.target, suffix, concurrent: '{"local": "concurrent"}' });
      assert.throws(() => f.apply(), /destination changed/);
      assert.equal(fs.readFileSync(f.target, "utf8"), '{"local": "concurrent"}');
      assert.deepEqual(f.temporaries(), []);
      assert.equal(f.backups().length, suffix === ".bak" ? 1 : 0);
      for (const backup of f.backups()) {
        assert.equal(fs.readFileSync(path.join(f.root, backup), "utf8"), '{"local": "original"}');
      }
    });
  }
});

test("a destination created during the write is not overwritten", (t) => {
  const f = fixture(t);
  changeAfterStaging(t, {
    target: f.target,
    suffix: ".tmp",
    concurrent: '{"local": "created by another writer"}',
  });
  assert.throws(() => f.apply(), /destination changed/);
  assert.equal(fs.readFileSync(f.target, "utf8"), '{"local": "created by another writer"}');
  assert.deepEqual(f.backups(), []);
  assert.deepEqual(f.temporaries(), []);
});
