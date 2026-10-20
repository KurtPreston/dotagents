"""Subprocess integration tests for installer selection, preflight, and settings."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which("bash")
EXPECTED_SETTINGS = {
    "attribution": {"commit": "", "pr": "", "sessionUrl": False},
    "env": {"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "DISABLE_FEEDBACK_COMMAND": "1"},
}
EXPECTED_COPILOT_SETTINGS = {"includeCoAuthoredBy": False}


@unittest.skipUnless(BASH, "installer integration tests require bash")
class InstallTests(unittest.TestCase):
    def setUp(self):
        # Copy only installer inputs; never run against real application homes.
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.repo = self.root / "repository fixture"
        self.repo.mkdir()
        for name in ("install.sh", "scripts/merge-settings.py",
                     "settings/claude.json", "settings/copilot.json"):
            destination = self.repo / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / name, destination)

        # Default rules are copied; this machine's other plugins are not.
        self.plugins = self.repo / "plugins"
        self.defaults = self.plugins / "dotagents-defaults"
        shutil.copytree(REPO_ROOT / "plugins" / "dotagents-defaults" / "rules",
                        self.defaults / "rules")
        self.agents = self.repo / "AGENTS.md"

        # A tiny skill exercises directory links without copying unrelated skills.
        self.skill = self.add_skill("dotagents-defaults", "test-skill")
        self.homes = {name: self.root / name.lower() for name in (
            "HOME", "CURSOR_HOME", "ZED_HOME", "CLAUDE_HOME", "COPILOT_HOME",
            "AGENTS_HOME")}
        self.settings = self.homes["CLAUDE_HOME"] / "settings.json"
        self.overlay = self.repo / "settings" / "claude.json"
        self.copilot_settings = self.homes["COPILOT_HOME"] / "settings.json"
        self.copilot_overlay = self.repo / "settings" / "copilot.json"

        # An allowlisted PATH makes missing-Python tests independent of the host.
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for command in ("dirname", "basename", "mkdir", "ln", "grep", "cat", "mv"):
            executable = shutil.which(command)
            self.assertIsNotNone(executable, "required shell utility: " + command)
            (self.bin / command).symlink_to(executable)
        (self.bin / "python3").symlink_to(sys.executable)
        self.env = {name: str(path) for name, path in self.homes.items()}
        self.env["PATH"] = str(self.bin)
        # Apple's Python otherwise caches bytecode under the fixture HOME.
        self.env["PYTHONDONTWRITEBYTECODE"] = "1"

    def install(self, *targets, success=True):
        result = subprocess.run(
            [BASH, str(self.repo / "install.sh"), *targets],
            cwd=self.root, env=self.env, capture_output=True, text=True, timeout=15)
        output = result.stdout + result.stderr
        if success:
            self.assertEqual(result.returncode, 0, output)
        else:
            self.assertNotEqual(result.returncode, 0, output)
            self.assertIn("error:", result.stderr.lower(), output)
        return result

    def snapshot_homes(self):
        # Include absent homes, directory entries, and link identities, not referents.
        snapshot = {}
        for home in self.homes.values():
            paths = [home, *sorted(home.rglob("*"))] if home.exists() else [home]
            for path in paths:
                if path.is_symlink():
                    snapshot[str(path)] = ("link", str(path.readlink()))
                elif path.is_file():
                    snapshot[str(path)] = ("file", path.read_bytes(),
                                           path.stat().st_mtime_ns)
                else:
                    snapshot[str(path)] = "directory" if path.exists() else "absent"
        return snapshot

    def assert_preflight_failure(self, *targets):
        before = self.snapshot_homes()
        result = self.install(*targets, success=False)
        self.assertEqual(self.snapshot_homes(), before,
                         "preflight must not create adapters, links, backups, or homes")
        return result

    def assert_link(self, path, source):
        self.assertTrue(path.is_symlink(), str(path))
        self.assertEqual(path.resolve(), source.resolve())

    def assert_installed(self, *targets):
        # Assert both selected integrations and isolation from unselected homes.
        cursor = self.homes["CURSOR_HOME"]
        if "cursor" in targets:
            adapter = cursor / "rules" / "dotagents.mdc"
            self.assertFalse(adapter.is_symlink())
            self.assertEqual(adapter.read_text(encoding="utf-8"),
                             "---\ndescription: Personal instructions shared across coding agents\n"
                             "alwaysApply: true\n---\n\n# Generated by dotagents\n\n"
                             + (self.repo / "AGENTS.md").read_text(encoding="utf-8"))
        else:
            self.assertFalse(cursor.exists())

        zed = self.homes["ZED_HOME"]
        if "zed" in targets:
            self.assert_link(zed / "AGENTS.md", self.repo / "AGENTS.md")
        else:
            self.assertFalse(zed.exists())
        shared = self.homes["AGENTS_HOME"]
        if {"cursor", "zed", "copilot"} & set(targets):
            self.assert_link(shared / "skills" / "test-skill", self.skill)
        else:
            self.assertFalse(shared.exists())

        claude = self.homes["CLAUDE_HOME"]
        if "claude" in targets:
            self.assert_link(claude / "CLAUDE.md", self.repo / "AGENTS.md")
            self.assert_link(claude / "skills" / "test-skill", self.skill)
            self.assertFalse(self.settings.is_symlink())
            self.assertEqual(json.loads(self.settings.read_bytes()), EXPECTED_SETTINGS)
        else:
            self.assertFalse(claude.exists())

        copilot = self.homes["COPILOT_HOME"]
        if "copilot" in targets:
            self.assert_link(copilot / "copilot-instructions.md", self.repo / "AGENTS.md")
            self.assertFalse(self.copilot_settings.is_symlink())
            self.assertEqual(json.loads(self.copilot_settings.read_bytes()),
                             EXPECTED_COPILOT_SETTINGS)
        else:
            self.assertFalse(copilot.exists())
        self.assertFalse(self.homes["HOME"].exists(), "all home overrides must be honored")

    def test_default_installs_all_integrations(self):
        self.install()
        self.assert_installed("cursor", "zed", "claude", "copilot")
        self.assertEqual(list(self.settings.parent.glob("settings.json.*.bak")), [])
        self.assertEqual(list(self.copilot_settings.parent.glob("settings.json.*.bak")), [])

    def test_claude_only_installs_instructions_skills_and_settings(self):
        self.install("claude")
        self.assert_installed("claude")

    def test_copilot_only_installs_instructions_skills_and_settings(self):
        self.overlay.write_text("not JSON", encoding="utf-8")
        self.install("copilot")
        self.assert_installed("copilot")

    def test_copilot_preserves_local_settings(self):
        # Copilot owns most of its settings; only the declared key is enforced.
        self.copilot_settings.parent.mkdir()
        self.copilot_settings.write_bytes(
            b'{"includeCoAuthoredBy": true, "theme": "dark"}\n')
        self.install("copilot")
        self.assertEqual(json.loads(self.copilot_settings.read_bytes()),
                         {"includeCoAuthoredBy": False, "theme": "dark"})
        backups = list(self.copilot_settings.parent.glob("settings.json.*.bak"))
        self.assertEqual(len(backups), 1)

    def test_cursor_only_does_not_require_python_or_valid_overlays(self):
        (self.bin / "python3").unlink()
        self.overlay.write_text("not JSON", encoding="utf-8")
        self.copilot_overlay.write_text("not JSON", encoding="utf-8")
        self.install("cursor")
        self.assert_installed("cursor")

    def test_zed_only_does_not_require_python_or_overlays(self):
        (self.bin / "python3").unlink()
        self.overlay.unlink()
        self.copilot_overlay.unlink()
        self.install("zed")
        self.assert_installed("zed")

    def test_cursor_and_zed_leave_invalid_claude_settings_untouched(self):
        (self.bin / "python3").unlink()
        self.settings.parent.mkdir()
        self.settings.write_bytes(b"invalid local settings\n")
        self.overlay.write_bytes(b"invalid overlay\n")
        before = self.settings.stat()
        self.install("cursor", "zed")
        self.assertEqual(self.settings.read_bytes(), b"invalid local settings\n")
        self.assertEqual(self.settings.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(list(self.settings.parent.iterdir()), [self.settings])
        self.assert_link(self.homes["ZED_HOME"] / "AGENTS.md", self.repo / "AGENTS.md")
        self.assert_link(self.homes["AGENTS_HOME"] / "skills" / "test-skill", self.skill)
        self.assertTrue((self.homes["CURSOR_HOME"] / "rules" / "dotagents.mdc").is_file())

    def test_rerun_preserves_local_nested_values_bytes_and_backups(self):
        # The first install replaces declared fields but backs up exact local bytes.
        original = (b'{ "attribution": {"commit": "local", "pr": "local", '
                    b'"sessionUrl": true, "local": {"enabled": true}}, '
                    b'"permissions": {"allow": ["Read"], "local": {"mode": "ask"}} }\n')
        self.settings.parent.mkdir()
        self.settings.write_bytes(original)
        self.install()
        expected = {"attribution": {**EXPECTED_SETTINGS["attribution"],
                                    "local": {"enabled": True}},
                    "env": EXPECTED_SETTINGS["env"],
                    "permissions": {"allow": ["Read"], "local": {"mode": "ask"}}}
        self.assertEqual(json.loads(self.settings.read_bytes()), expected)
        backups = list(self.settings.parent.glob("settings.json.*.bak"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original)

        # Repeat the full install, including regenerating its managed Cursor adapter.
        contents = self.settings.read_bytes()
        metadata = self.settings.stat()
        entries = set(self.settings.parent.iterdir())
        backup_contents = backups[0].read_bytes()
        result = self.install()
        self.assertIn("unchanged " + str(self.settings), result.stdout)
        self.assertEqual(self.settings.read_bytes(), contents)
        self.assertEqual(self.settings.stat().st_mtime_ns, metadata.st_mtime_ns)
        self.assertEqual(self.settings.stat().st_ino, metadata.st_ino)
        self.assertEqual(set(self.settings.parent.iterdir()), entries)
        self.assertEqual(backups[0].read_bytes(), backup_contents)

    def test_unknown_targets_are_all_validated_before_installation(self):
        for targets in (("unknown",), ("cursor", "unknown"),
                        ("zed", "claude", "unknown"), ("claude", "cursor", "unknown")):
            with self.subTest(targets=targets):
                result = self.assert_preflight_failure(*targets)
                self.assertIn("unknown target", result.stderr)
                self.assertIn("unknown", result.stderr)

    def test_missing_python_fails_before_any_selected_integration(self):
        (self.bin / "python3").unlink()
        self.assertIsNone(shutil.which("python3", path=self.env["PATH"]))
        for targets in ((), ("claude",), ("copilot",), ("cursor", "zed", "claude"),
                        ("cursor", "copilot")):
            with self.subTest(targets=targets):
                result = self.assert_preflight_failure(*targets)
                self.assertIn("python3", result.stderr.lower())
                self.assertRegex(result.stderr.lower(), r"require|install|not found|missing")

    def test_invalid_destination_json_fails_before_adapters_or_links(self):
        self.settings.parent.mkdir()
        for raw in (b"", b"{", b"[]", b'{"a": 1, "a": 2}',
                    b'{"value": NaN}', b'{"attribution": "local"}'):
            with self.subTest(raw=raw):
                self.settings.write_bytes(raw)
                self.assert_preflight_failure()

    def test_invalid_overlay_fails_before_adapters_or_links(self):
        for raw in (b"", b"{", b"null", b'{"a": 1, "a": 2}', b'{"value": Infinity}'):
            with self.subTest(raw=raw):
                self.overlay.write_bytes(raw)
                self.assert_preflight_failure()
        self.overlay.unlink()
        self.assert_preflight_failure()

    def test_invalid_copilot_settings_fail_before_any_integration(self):
        # Copilot is checked after Claude, so Claude must not be applied first.
        self.copilot_settings.parent.mkdir()
        for raw in (b"", b"{", b"[]", b'// comment\n{}', b'{"a": 1, "a": 2}'):
            with self.subTest(raw=raw):
                self.copilot_settings.write_bytes(raw)
                self.assert_preflight_failure()
                self.assert_preflight_failure("copilot")
        self.copilot_settings.unlink()

        # A broken repository overlay also stops installation up front.
        self.copilot_overlay.write_bytes(b"{")
        self.assert_preflight_failure()
        self.copilot_overlay.unlink()
        self.assert_preflight_failure("copilot")

    def test_settings_directory_is_rejected_before_installation(self):
        self.settings.mkdir(parents=True)
        self.assert_preflight_failure()

    def test_settings_symlinks_are_rejected_without_touching_referents(self):
        # Both existing and dangling settings links must survive a failed preflight.
        self.settings.parent.mkdir()
        referent = self.root / "local-settings.json"
        for dangling in (False, True):
            with self.subTest(dangling=dangling):
                if not dangling:
                    referent.write_bytes(b'{"local": "keep"}\n')
                self.settings.symlink_to(referent)
                result = self.assert_preflight_failure()
                self.assertIn("symlink", result.stderr.lower())
                self.assertEqual(self.settings.readlink(), referent)
                self.assertEqual(referent.exists(), not dangling)
                if not dangling:
                    self.assertEqual(referent.read_bytes(), b'{"local": "keep"}\n')
                    referent.unlink()
                self.settings.unlink()

    def test_user_managed_instruction_files_are_not_overwritten(self):
        for target, path in (
                ("cursor", self.homes["CURSOR_HOME"] / "rules" / "dotagents.mdc"),
                ("zed", self.homes["ZED_HOME"] / "AGENTS.md"),
                ("claude", self.homes["CLAUDE_HOME"] / "CLAUDE.md"),
                ("copilot", self.homes["COPILOT_HOME"] / "copilot-instructions.md")):
            with self.subTest(target=target):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"User-managed instructions.\n")
                result = self.install(target, success=False)
                self.assertIn(str(path), result.stderr)
                self.assertFalse(path.is_symlink())
                self.assertEqual(path.read_bytes(), b"User-managed instructions.\n")
                self.assertFalse(self.settings.exists())
                self.assertFalse(self.copilot_settings.exists())

    def add_rule(self, plugin, name, text):
        rule = self.plugins / plugin / "rules" / name
        rule.parent.mkdir(parents=True, exist_ok=True)
        rule.write_text(text, encoding="utf-8")
        return rule

    def test_agents_joins_default_then_plugin_rules_in_order(self):
        # Defaults load first even when another plugin sorts before them.
        self.add_rule("zeta", "a.md", "## Zeta A\n")
        self.add_rule("alpha", "b.md", "## Alpha B\n")
        self.add_rule("alpha", "a.md", "## Alpha A\n")
        self.add_rule("alpha", "notes.txt", "Ignored.\n")
        (self.plugins / "empty").mkdir()
        self.install("zed")
        defaults = sorted((self.defaults / "rules").glob("*.md"))
        self.assertTrue(defaults)
        parts = [path.read_text(encoding="utf-8") for path in defaults]
        parts += ["## Alpha A\n", "## Alpha B\n", "## Zeta A\n"]
        generated = self.agents.read_text(encoding="utf-8")
        marker, body = generated.split("\n\n", 1)
        self.assertIn("Generated by install.sh", marker)
        self.assertEqual(body, "\n".join(parts))
        self.assert_installed("zed")

        # Reinstalling picks up edited rules and drops removed ones.
        (self.plugins / "alpha" / "rules" / "a.md").unlink()
        self.install("zed")
        self.assertNotIn("## Alpha A", self.agents.read_text(encoding="utf-8"))
        self.assertIn("## Alpha B", self.agents.read_text(encoding="utf-8"))

    def test_hand_written_agents_is_not_overwritten(self):
        self.agents.write_bytes(b"Hand-written instructions.\n")
        result = self.assert_preflight_failure("zed")
        self.assertIn(str(self.agents), result.stderr)
        self.assertEqual(self.agents.read_bytes(), b"Hand-written instructions.\n")

    def test_older_generated_agents_marker_is_replaced(self):
        # Any install.sh marker counts as generated, so marker wording can change.
        self.agents.write_text("<!-- Generated by install.sh from rules/. -->\n\nOld.\n",
                               encoding="utf-8")
        self.install("zed")
        self.assertNotIn("Old.", self.agents.read_text(encoding="utf-8"))

    def test_missing_default_rules_fail_before_installation(self):
        shutil.rmtree(self.defaults / "rules")
        self.add_rule("alpha", "a.md", "## Alpha A\n")
        self.assert_preflight_failure("zed")
        self.assertFalse(self.agents.exists())

    def test_user_managed_skill_directories_are_not_replaced(self):
        for target, home in (("cursor", "AGENTS_HOME"), ("claude", "CLAUDE_HOME"),
                             ("copilot", "AGENTS_HOME")):
            with self.subTest(target=target):
                skill = self.homes[home] / "skills" / "test-skill"
                skill.mkdir(parents=True, exist_ok=True)
                local = skill / "SKILL.md"
                local.write_bytes(b"Local skill.\n")
                result = self.install(target, success=False)
                self.assertIn(str(skill), result.stderr)
                self.assertFalse(skill.is_symlink())
                self.assertEqual(local.read_bytes(), b"Local skill.\n")

    def add_skill(self, plugin, name):
        skill = self.plugins / plugin / "skills" / name
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: Installer fixture\n---\nTest skill.\n",
            encoding="utf-8")
        return skill

    def test_plugin_skills_are_linked_beside_default_skills(self):
        alpha = self.add_skill("alpha", "alpha-skill")
        zeta = self.add_skill("zeta", "zeta-skill")
        self.install()
        self.assert_installed("cursor", "zed", "claude", "copilot")
        for home in ("AGENTS_HOME", "CLAUDE_HOME"):
            with self.subTest(home=home):
                self.assert_link(self.homes[home] / "skills" / "alpha-skill", alpha)
                self.assert_link(self.homes[home] / "skills" / "zeta-skill", zeta)

    def test_duplicate_skill_names_fail_before_installation(self):
        # A plugin may not reuse a default skill's name, or another plugin's.
        for plugins, name in ((("dotagents-defaults", "alpha"), "test-skill"),
                              (("alpha", "zeta"), "shared-skill")):
            with self.subTest(plugins=plugins):
                added = [self.add_skill(plugin, name) for plugin in plugins
                         if plugin != "dotagents-defaults"]
                result = self.assert_preflight_failure()
                self.assertIn(name, result.stderr)
                for plugin in plugins:
                    self.assertIn("plugins/" + plugin, result.stderr)
                self.assertFalse(self.agents.exists())
                for skill in added:
                    shutil.rmtree(skill)

    def test_helper_checks_precede_mutations_and_applies_follow_links(self):
        # Instrument only the fixture helper, retaining the real merge implementation.
        helper = self.repo / "scripts" / "merge-settings.py"
        helper.rename(helper.with_name("real-merge-settings.py"))
        log = self.root / "helper-calls.jsonl"
        self.env["INSTALL_TEST_LOG"] = str(log)
        helper.write_text(
            "import json, os, pathlib, runpy, sys\n"
            "homes = [pathlib.Path(os.environ[name]) for name in "
            "('HOME', 'CURSOR_HOME', 'ZED_HOME', 'CLAUDE_HOME', 'COPILOT_HOME', "
            "'AGENTS_HOME')]\n"
            "record = {'args': sys.argv[1:], 'homes_exist': [p.exists() for p in homes], "
            "'claude_link': (homes[3] / 'CLAUDE.md').is_symlink(), "
            "'copilot_link': (homes[4] / 'copilot-instructions.md').is_symlink()}\n"
            "with open(os.environ['INSTALL_TEST_LOG'], 'a') as stream:\n"
            "    stream.write(json.dumps(record) + '\\n')\n"
            "runpy.run_path(str(pathlib.Path(__file__).with_name('real-merge-settings.py')), "
            "run_name='__main__')\n", encoding="utf-8")

        # Both checks run read-only before any agent home exists.
        self.install()
        calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(calls), 4)
        for call in calls[:2]:
            self.assertIn("--check", call["args"])
            self.assertEqual(call["homes_exist"], [False] * len(self.homes))
        for call in calls[2:]:
            self.assertNotIn("--check", call["args"])

        # Each apply targets its own agent and runs after that agent's link.
        claude_calls = (calls[0], calls[2])
        copilot_calls = (calls[1], calls[3])
        self.assertTrue(calls[2]["claude_link"])
        self.assertTrue(calls[3]["copilot_link"])
        for call in claude_calls:
            self.assertEqual(call["args"][-2:], [str(self.overlay), str(self.settings)])
        for call in copilot_calls:
            self.assertEqual(call["args"][-2:],
                             [str(self.copilot_overlay), str(self.copilot_settings)])
        self.assert_installed("cursor", "zed", "claude", "copilot")

if __name__ == "__main__":
    unittest.main()
