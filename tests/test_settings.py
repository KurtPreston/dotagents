"""Phase-one contract tests for the strict JSON settings overlay helper."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock


HELPER_PATH = Path(__file__).resolve().parents[1] / "scripts" / "merge-settings.py"
SPEC = importlib.util.spec_from_file_location("merge_settings", HELPER_PATH)
settings = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(settings)


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.overlay = self.root / "overlay.json"
        self.target = self.root / "settings.json"
        self.overlay.write_text('{"managed": true}', encoding="utf-8")

    def apply(self, **kwargs):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            settings.apply_settings(self.overlay, self.target, **kwargs)
        return output.getvalue()

    def backups(self):
        return sorted(self.root.glob("settings.json.*.bak"))

    def assert_no_temporaries(self):
        self.assertEqual(list(self.root.rglob("*.tmp")), [])

    def assert_rejected(self, pattern):
        # Validation failures must not touch either inputs or directory entries.
        entries = set(self.root.iterdir())
        original = self.target.read_bytes() if self.target.exists() else None
        metadata = self.target.stat() if self.target.exists() else None
        with self.assertRaisesRegex(settings.SettingsError, pattern):
            self.apply()
        self.assertEqual(set(self.root.iterdir()), entries)
        if original is not None:
            self.assertEqual(self.target.read_bytes(), original)
            self.assertEqual(self.target.stat().st_mtime_ns, metadata.st_mtime_ns)
        else:
            self.assertFalse(self.target.exists())

    def test_nested_merge_preserves_undeclared_values(self):
        base = {"attribution": {"commit": "old", "pr": "old", "local": "keep"},
                "permissions": {"allow": ["read"]}, "plugins": ["local"]}
        overlay = {"attribution": {"commit": "", "pr": ""},
                   "new": {"nested": {"enabled": True}}}
        self.target.write_text(json.dumps(base), encoding="utf-8")
        self.overlay.write_text(json.dumps(overlay), encoding="utf-8")
        self.apply()
        self.assertEqual(json.loads(self.target.read_bytes()), {
            "attribution": {"commit": "", "pr": "", "local": "keep"},
            "permissions": {"allow": ["read"]}, "plugins": ["local"],
            "new": {"nested": {"enabled": True}},
        })

    def test_scalars_arrays_and_null_replace_instead_of_delete(self):
        base = {"text": "old", "number": 1, "flag": True, "array": [1, 2],
                "object": {"keep": False}, "null": {"old": True}}
        overlay = {"text": "new", "number": 2, "flag": False, "array": [3],
                   "object": "replacement", "null": None, "new_null": None}
        self.target.write_text(json.dumps(base), encoding="utf-8")
        self.overlay.write_text(json.dumps(overlay), encoding="utf-8")
        self.apply()
        self.assertEqual(json.loads(self.target.read_bytes()), overlay)

    def test_merge_does_not_mutate_input_objects(self):
        base = {"nested": {"local": [1], "managed": "old"}}
        overlay = {"nested": {"managed": "new"}}
        self.assertEqual(settings.merge(base, overlay), {
            "nested": {"local": [1], "managed": "new"}})
        self.assertEqual(base, {"nested": {"local": [1], "managed": "old"}})
        self.assertEqual(overlay, {"nested": {"managed": "new"}})

    def test_object_over_non_object_conflicts_report_nested_path(self):
        self.overlay.write_text('{"outer": {"managed": {}}}', encoding="utf-8")
        for value in (None, False, 0, "local", [1]):
            with self.subTest(value=value):
                self.target.write_text(json.dumps({"outer": {"managed": value}}),
                                       encoding="utf-8")
                self.assert_rejected(r'object conflicts.*\$\["outer"\]\["managed"\]')

    def test_missing_destination_creates_parents_and_private_json(self):
        self.target = self.root / "missing" / "nested" / "settings.json"
        output = self.apply()
        self.assertEqual(json.loads(self.target.read_bytes()), {"managed": True})
        self.assertEqual(self.target.read_bytes(), b'{\n  "managed": true\n}\n')
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o600)
        self.assertEqual(list(self.root.rglob("*.bak")), [])
        self.assertIn("updated " + str(self.target), output)
        self.assert_no_temporaries()

    def test_empty_overlay_still_creates_missing_destination(self):
        self.overlay.write_text("{}", encoding="utf-8")
        self.apply()
        self.assertEqual(self.target.read_bytes(), b"{}\n")
        self.assertEqual(self.backups(), [])

    def test_missing_overlay_does_not_create_destination(self):
        self.overlay.unlink()
        with self.assertRaises(FileNotFoundError):
            self.apply()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_invalid_json_in_either_document_is_rejected(self):
        # Include nested ambiguity and numeric overflow, not just syntax errors.
        invalid = [b"", b" \n\t", b'{"secret":', b'{"a": 1,}',
                   b'{"a": 1, "a": 2}', b'{"nested": {"a": 1, "a": 2}}',
                   b'{"value": NaN}', b'{"value": Infinity}',
                   b'{"value": -Infinity}', b'{"value": 1e999}',
                   b'{"value": "\xff"}']
        for document in (self.overlay, self.target):
            for raw in invalid:
                with self.subTest(document=document.name, raw=raw):
                    self.overlay.write_bytes(b'{"managed": true}')
                    self.target.write_bytes(b'{"local": "keep"}')
                    document.write_bytes(raw)
                    self.assert_rejected("invalid or ambiguous JSON")

    def test_non_object_roots_in_either_document_are_rejected(self):
        for document in (self.overlay, self.target):
            for raw in (b"[]", b"null", b"true", b"1", b'"text"'):
                with self.subTest(document=document.name, raw=raw):
                    self.overlay.write_bytes(b'{"managed": true}')
                    self.target.write_bytes(b'{"local": "keep"}')
                    document.write_bytes(raw)
                    self.assert_rejected("JSON root must be an object")

    def test_invalid_overlay_does_not_create_parent_directories(self):
        self.target = self.root / "absent" / "settings.json"
        self.overlay.write_bytes(b'{"duplicate": 1, "duplicate": 2}')
        self.assert_rejected("invalid or ambiguous JSON")
        self.assertFalse(self.target.parent.exists())

    def test_destination_symlink_and_dangling_symlink_are_refused(self):
        referent = self.root / "referent.json"
        for dangling in (False, True):
            with self.subTest(dangling=dangling):
                if not dangling:
                    referent.write_bytes(b'{"local": "keep"}')
                self.target.symlink_to(referent)
                with self.assertRaisesRegex(settings.SettingsError, "symlink"):
                    self.apply()
                self.assertTrue(self.target.is_symlink())
                self.assertEqual(self.target.readlink(), referent)
                self.assertEqual(referent.exists(), not dangling)
                if not dangling:
                    self.assertEqual(referent.read_bytes(), b'{"local": "keep"}')
                    referent.unlink()
                self.assertEqual(self.backups(), [])
                self.assert_no_temporaries()
                self.target.unlink()

    def test_directory_destination_is_refused(self):
        self.target.mkdir()
        with self.assertRaisesRegex(settings.SettingsError, "regular file"):
            self.apply()
        self.assertTrue(self.target.is_dir())
        self.assertEqual(list(self.target.iterdir()), [])
        self.assertEqual(self.backups(), [])
        self.assert_no_temporaries()

    def test_backup_is_exact_private_and_non_overwriting(self):
        original = b'{ "local" : "caf\xc3\xa9", "managed" : false }\r\n'
        self.target.write_bytes(original)
        self.target.chmod(0o640)
        output = self.apply()
        first_backup, = self.backups()
        self.assertEqual(first_backup.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(first_backup.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o640)
        self.assertIn("backup " + str(first_backup), output)
        self.assertNotIn("caf", output)

        # A second real update must retain the previous recovery file unchanged.
        intermediate = self.target.read_bytes()
        self.overlay.write_text('{"managed": false}', encoding="utf-8")
        self.apply()
        backups = self.backups()
        self.assertEqual(len(backups), 2)
        second_backup, = set(backups) - {first_backup}
        self.assertEqual(first_backup.read_bytes(), original)
        self.assertEqual(second_backup.read_bytes(), intermediate)
        self.assertEqual(stat.S_IMODE(second_backup.stat().st_mode), 0o600)
        self.assert_no_temporaries()

    def test_unchanged_preserves_bytes_metadata_and_backups(self):
        original = b'{ "local": 3, "managed" : true }\r\n'
        self.target.write_bytes(original)
        self.target.chmod(0o640)
        before = self.target.stat()
        with mock.patch.object(settings, "stage_file") as stage:
            output = self.apply()
        stage.assert_not_called()
        after = self.target.stat()
        self.assertEqual(self.target.read_bytes(), original)
        self.assertEqual((after.st_ino, after.st_mode, after.st_mtime_ns, after.st_ctime_ns),
                         (before.st_ino, before.st_mode, before.st_mtime_ns, before.st_ctime_ns))
        self.assertEqual(self.backups(), [])
        self.assertIn("unchanged " + str(self.target), output)

    def test_repeated_install_is_idempotent_and_removed_keys_are_retained(self):
        self.target.write_text('{"local": 1}', encoding="utf-8")
        self.apply()
        original = self.target.read_bytes()
        before = self.target.stat()
        backups = {path: path.read_bytes() for path in self.backups()}
        for overlay in ('{"managed": true}', '{}'):
            with self.subTest(overlay=overlay):
                self.overlay.write_text(overlay, encoding="utf-8")
                self.assertIn("unchanged", self.apply())
                self.assertEqual(self.target.read_bytes(), original)
                self.assertEqual(self.target.stat().st_mtime_ns, before.st_mtime_ns)
                self.assertEqual(self.target.stat().st_ino, before.st_ino)
                self.assertEqual({path: path.read_bytes() for path in self.backups()}, backups)

    def test_bool_and_number_are_not_treated_as_equal(self):
        for old, new in ((True, 1), (1, True), (False, 0), (0, False)):
            for location in ("scalar", "array", "nested"):
                with self.subTest(old=old, new=new, location=location):
                    wrap = {"scalar": lambda value: value,
                            "array": lambda value: [value],
                            "nested": lambda value: {"value": value}}[location]
                    self.target.write_text(json.dumps({"managed": wrap(old)}), encoding="utf-8")
                    self.overlay.write_text(json.dumps({"managed": wrap(new)}), encoding="utf-8")
                    self.assertIn("updated", self.apply())
                    actual = json.loads(self.target.read_bytes())
                    self.assertEqual(json.dumps(actual), json.dumps({"managed": wrap(new)}))

    def test_check_cli_validates_without_any_writes(self):
        for exists in (False, True):
            with self.subTest(exists=exists):
                self.target = self.root / "absent" / "settings.json" if not exists else self.root / "settings.json"
                if exists:
                    self.target.write_bytes(b'{"local": true}')
                    before = self.target.stat()
                output = io.StringIO()
                argv = [str(HELPER_PATH), "--check", str(self.overlay), str(self.target)]
                with mock.patch.object(settings.sys, "argv", argv), \
                        mock.patch.object(settings, "stage_file") as stage, \
                        mock.patch.object(settings.Path, "mkdir") as mkdir, \
                        mock.patch.object(settings.os, "replace") as replace, \
                        contextlib.redirect_stdout(output):
                    self.assertEqual(settings.main(), 0)
                stage.assert_not_called()
                mkdir.assert_not_called()
                replace.assert_not_called()
                self.assertIn("validated " + str(self.target), output.getvalue())
                if exists:
                    self.assertEqual(self.target.read_bytes(), b'{"local": true}')
                    self.assertEqual(self.target.stat().st_mtime_ns, before.st_mtime_ns)
                    self.assertEqual(self.target.stat().st_ctime_ns, before.st_ctime_ns)
                else:
                    self.assertFalse(self.target.parent.exists())
                self.assertEqual(self.backups(), [])
                self.assert_no_temporaries()

    def test_check_cli_reports_invalid_input_without_exposing_values(self):
        self.target.write_bytes(b'{"secret": "do-not-log",}')
        error = io.StringIO()
        argv = [str(HELPER_PATH), "--check", str(self.overlay), str(self.target)]
        with mock.patch.object(settings.sys, "argv", argv), contextlib.redirect_stderr(error):
            self.assertEqual(settings.main(), 1)
        self.assertIn(str(self.target), error.getvalue())
        self.assertNotIn("do-not-log", error.getvalue())
        self.assertEqual(self.target.read_bytes(), b'{"secret": "do-not-log",}')
        self.assertEqual(self.backups(), [])
        self.assert_no_temporaries()

    def test_backup_creation_failure_aborts_and_cleans_staged_output(self):
        original = b'{"local": "keep"}'
        self.target.write_bytes(original)
        mkstemp = settings.tempfile.mkstemp

        def fail_backup(*args, **kwargs):
            if kwargs.get("suffix") == ".bak":
                raise OSError("controlled backup creation failure")
            return mkstemp(*args, **kwargs)

        with mock.patch.object(settings.tempfile, "mkstemp", side_effect=fail_backup), \
                mock.patch.object(settings.os, "replace") as replace:
            with self.assertRaisesRegex(OSError, "controlled backup creation failure"):
                self.apply()
        replace.assert_not_called()
        self.assertEqual(self.target.read_bytes(), original)
        self.assertEqual(set(self.root.iterdir()), {self.overlay, self.target})

    def test_partial_write_failures_clean_up_output_and_backup(self):
        original = b'{"local": "keep"}'
        fdopen = settings.os.fdopen
        for fail_on in (1, 2):
            with self.subTest(stage="output" if fail_on == 1 else "backup"):
                self.target.write_bytes(original)
                writes = 0

                @contextlib.contextmanager
                def failing_fdopen(fd, mode):
                    nonlocal writes
                    with fdopen(fd, mode) as stream:
                        if mode == "wb":
                            writes += 1
                            if writes == fail_on:
                                # Leave partial bytes so cleanup is exercised after a real write.
                                proxy = mock.Mock(wraps=stream)

                                def fail_write(raw):
                                    stream.write(raw[:3])
                                    raise OSError("controlled partial write failure")

                                proxy.write.side_effect = fail_write
                                yield proxy
                                return
                        yield stream

                with mock.patch.object(settings.os, "fdopen", side_effect=failing_fdopen), \
                        mock.patch.object(settings.os, "replace") as replace:
                    with self.assertRaisesRegex(OSError, "controlled partial write failure"):
                        self.apply()
                replace.assert_not_called()
                self.assertEqual(self.target.read_bytes(), original)
                self.assertEqual(set(self.root.iterdir()), {self.overlay, self.target})

    def test_replace_failure_preserves_original_and_exact_backup(self):
        original = b'{ "local": "keep" }\n'
        self.target.write_bytes(original)
        with mock.patch.object(settings.os, "replace", side_effect=OSError("controlled replace failure")):
            with self.assertRaisesRegex(OSError, "controlled replace failure"):
                self.apply()
        self.assertEqual(self.target.read_bytes(), original)
        backup, = self.backups()
        self.assertEqual(backup.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
        self.assert_no_temporaries()

    def test_concurrent_destination_change_aborts_before_replace(self):
        original = b'{"local": "original"}'
        concurrent = b'{"local": "concurrent"}'
        stage_file = settings.stage_file
        for change_after in (".tmp", ".bak"):
            with self.subTest(change_after=change_after):
                self.target.write_bytes(original)

                def change_destination(target, raw, mode, suffix):
                    staged = stage_file(target, raw, mode, suffix)
                    if suffix == change_after:
                        target.write_bytes(concurrent)
                    return staged

                with mock.patch.object(settings, "stage_file", side_effect=change_destination), \
                        mock.patch.object(settings.os, "replace") as replace:
                    with self.assertRaisesRegex(settings.SettingsError, "destination changed"):
                        self.apply()
                replace.assert_not_called()
                self.assertEqual(self.target.read_bytes(), concurrent)
                self.assert_no_temporaries()
                self.assertEqual(len(self.backups()), int(change_after == ".bak"))
                for backup in self.backups():
                    self.assertEqual(backup.read_bytes(), original)
                    backup.unlink()

    def test_concurrently_created_destination_is_not_overwritten(self):
        concurrent = b'{"local": "created by another writer"}'
        stage_file = settings.stage_file

        def create_destination(target, raw, mode, suffix):
            staged = stage_file(target, raw, mode, suffix)
            target.write_bytes(concurrent)
            return staged

        with mock.patch.object(settings, "stage_file", side_effect=create_destination), \
                mock.patch.object(settings.os, "replace") as replace:
            with self.assertRaisesRegex(settings.SettingsError, "destination changed"):
                self.apply()
        replace.assert_not_called()
        self.assertEqual(self.target.read_bytes(), concurrent)
        self.assertEqual(self.backups(), [])
        self.assert_no_temporaries()


if __name__ == "__main__":
    unittest.main()
