"""Tests for interactive credential, cancellation, and terminal-input behavior."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from missdata.agent import Agent
from missdata.cli import _masked_key, handle_slash_command
from missdata.config import Settings, delete_api_keys, get_api_keys, save_api_keys
from missdata.terminal_input import TerminalInput


class CredentialManagementTests(unittest.TestCase):
    def test_masked_key_does_not_contain_full_credential(self):
        key = "super-secret-key-abcdef123456"
        displayed = _masked_key(key)
        self.assertNotIn(key, displayed)
        self.assertIn("supe", displayed)
        self.assertIn("3456", displayed)

    def test_delete_api_keys_removes_pool_and_legacy_environment(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ, {"GROQ_API_KEY": "", "GROQ_API_KEYS": ""}, clear=False
        ), patch("missdata.config.CONFIG_DIR", Path(directory)):
            save_api_keys("groq", ["first-key", "second-key"])
            self.assertEqual(["first-key", "second-key"], get_api_keys("groq"))
            delete_api_keys("groq")
            self.assertEqual([], get_api_keys("groq"))
            self.assertFalse((Path(directory) / ".env").read_text(encoding="utf-8").strip())

    def test_keys_show_is_masked_by_default(self):
        agent = SimpleNamespace(logger=MagicMock(), settings=Settings(provider="groq"), cwd="/tmp", sandbox_root="/tmp")
        settings = agent.settings
        secret = "super-secret-key-abcdef123456"
        with patch("missdata.cli.get_api_keys", return_value=[secret]), patch("builtins.print") as output:
            handle_slash_command("/keys show groq", agent, settings)
        rendered = "\n".join(str(call.args) for call in output.call_args_list)
        self.assertNotIn(secret, rendered)
        self.assertIn("supe", rendered)


class _InterruptingProvider:
    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    def stream_turn(self, messages, tool_schemas):
        raise KeyboardInterrupt


class ResponseCancellationTests(unittest.TestCase):
    def test_ctrl_c_removes_incomplete_user_turn_and_logs_cancellation(self):
        agent = Agent.__new__(Agent)
        agent.settings = Settings(provider="groq")
        agent._provider = _InterruptingProvider()
        agent._active_api_key = "test-key"
        agent.messages = [{"role": "system", "content": "system"}]
        agent._touched_files = set()
        agent._marker_shown = False
        agent._tool_calls_completed = 0
        agent._spinner = MagicMock()
        agent.logger = MagicMock()

        with patch("missdata.agent.ui.print_info"):
            agent.run_turn("unfinished request")

        self.assertEqual([{"role": "system", "content": "system"}], agent.messages)
        self.assertTrue(any(
            call.args[0] == "turn_cancelled" for call in agent.logger.event.call_args_list
        ))


class TerminalInputTests(unittest.TestCase):
    def test_plain_input_fallback_remains_available(self):
        terminal = TerminalInput(Path("/tmp/missdata-history-test"), fallback_input=lambda label: "typed request")
        self.assertEqual("typed request", terminal.prompt("You > "))

    def test_colored_prompt_is_wrapped_as_ansi_formatted_text(self):
        terminal = TerminalInput(Path("/tmp/missdata-history-test"))
        terminal._ready = True
        terminal._session = MagicMock()
        terminal._session.prompt.return_value = "typed request"
        self.assertEqual("typed request", terminal.prompt("\\x1b[1mYou\\x1b[0m > "))
        prompt_argument = terminal._session.prompt.call_args.args[0]
        self.assertNotIsInstance(prompt_argument, str)


if __name__ == "__main__":
    unittest.main()
