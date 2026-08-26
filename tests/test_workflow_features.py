"""Focused tests for the local-first workflow enhancement set."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from missdata import sessions
from missdata.agent import Agent
from missdata.config import Settings, export_settings, import_settings
from missdata.providers import StreamResult
from missdata.workflows import (
    TRUSTED_UPDATE_REMOTE, _normalized_remote, discover_tests, estimate_context,
    project_map, trusted_update_remote,
)


class ProjectAwarenessTests(unittest.TestCase):
    def test_map_and_test_discovery_use_local_markers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pyproject.toml").write_text("[project]\nname='demo'\n", encoding="utf-8")
            (root / "main.py").write_text("print('hello')\n", encoding="utf-8")
            (root / "tests").mkdir()
            (root / "tests" / "test_demo.py").write_text("", encoding="utf-8")
            rendered = project_map(directory)
            self.assertIn("Python", rendered)
            self.assertIn("python -m unittest discover", rendered)
            self.assertEqual("python -m unittest discover", discover_tests(directory)[0].command)

    def test_context_estimate_is_transparent_character_based(self):
        chars, tokens = estimate_context([{"content": "abcd"}, {"content": "ef"}])
        self.assertEqual(6, chars)
        self.assertEqual(2, tokens)


class SettingsBackupTests(unittest.TestCase):
    def test_export_and_import_are_settings_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            original = Settings(provider="groq", groq_model="demo", approval_mode="always", work_profile="explore")
            export_settings(path, original)
            serialized = path.read_text(encoding="utf-8")
            self.assertNotIn("GROQ_API_KEY", serialized)
            restored = import_settings(path)
            self.assertEqual("groq", restored.provider)
            self.assertEqual("demo", restored.model)
            self.assertEqual("explore", restored.work_profile)


class SessionPersistenceTests(unittest.TestCase):
    def test_save_list_rename_and_delete_session(self):
        with tempfile.TemporaryDirectory() as directory, patch("missdata.sessions.SESSIONS_DIR", Path(directory)):
            session_id = sessions.new_session_id()
            sessions.save(session_id, title="Original", cwd="/tmp", provider="groq", model="demo", messages=[{"role": "user", "content": "hi"}], activity_log="/tmp/log")
            self.assertEqual("Original", sessions.list_sessions()[0]["title"])
            sessions.rename(session_id, "Renamed")
            self.assertEqual("Renamed", sessions.load(session_id)["title"])
            self.assertTrue(sessions.delete(session_id))
            self.assertEqual([], sessions.list_sessions())


class TrustedUpdateTests(unittest.TestCase):
    def test_remote_normalization_accepts_only_official_repository_equivalent(self):
        self.assertEqual(_normalized_remote(TRUSTED_UPDATE_REMOTE), _normalized_remote("https://github.com/RootedMani/Miss-Data"))
        self.assertNotEqual(_normalized_remote(TRUSTED_UPDATE_REMOTE), _normalized_remote("https://example.invalid/other.git"))

    def test_non_repository_cannot_self_update(self):
        with tempfile.TemporaryDirectory() as directory:
            ok, detail = trusted_update_remote(directory)
        self.assertFalse(ok)
        self.assertIn("not installed from a Git repository", detail)


class _ReviewProvider:
    def __init__(self):
        self.tool_names: list[str] = []

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    def stream_turn(self, messages, schemas):
        self.tool_names = [schema["name"] for schema in schemas]
        return StreamResult(text="review complete", tool_calls=[])

    def append_assistant_turn(self, messages, result):
        messages.append({"role": "assistant", "content": result.text})


class ReadOnlyReviewTests(unittest.TestCase):
    def test_read_only_turn_excludes_mutating_tools(self):
        provider = _ReviewProvider()
        agent = Agent.__new__(Agent)
        agent.settings = Settings(provider="groq")
        agent._provider = provider
        agent._active_api_key = "test-key"
        agent.messages = [{"role": "system", "content": "system"}]
        agent._touched_files = set()
        agent._marker_shown = False
        agent._tool_calls_completed = 0
        agent._spinner = MagicMock()
        agent.logger = MagicMock()
        agent.pending_request = None
        with patch("missdata.agent.ui.print_files_summary"), patch("missdata.agent.ui.print_info"):
            agent.run_turn("review", read_only=True)
        self.assertIn("read_file", provider.tool_names)
        self.assertNotIn("write_file", provider.tool_names)
        self.assertNotIn("run_command", provider.tool_names)


if __name__ == "__main__":
    unittest.main()
