"""Focused tests for multi-key resilience and local activity logging."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from missdata.activity import ActivityLogger
from missdata.agent import Agent
from missdata.config import Settings, get_api_keys
from missdata.providers import ProviderError


class KeyPoolConfigTests(unittest.TestCase):
    def test_json_key_pool_is_ordered_and_deduplicated(self):
        with patch.dict(
            os.environ,
            {"GROQ_API_KEYS": '["first-key", "second-key", "first-key"]', "GROQ_API_KEY": "second-key"},
            clear=False,
        ):
            self.assertEqual(["first-key", "second-key"], get_api_keys("groq"))

    def test_comma_separated_key_pool_is_supported(self):
        with patch.dict(
            os.environ,
            {"OPENAI_API_KEYS": "first-key, second-key", "OPENAI_API_KEY": ""},
            clear=False,
        ):
            self.assertEqual(["first-key", "second-key"], get_api_keys("openai"))


class ActivityLogTests(unittest.TestCase):
    def test_log_redacts_secret_fields_and_values(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"EXAMPLE_API_KEY": "secret-token-123456789"}, clear=False):
                logger = ActivityLogger(session_id="test-session", directory=Path(directory))
                logger.event(
                    "test_event",
                    api_key="secret-token-123456789",
                    message="do not retain secret-token-123456789",
                    nested={"authorization": "Bearer secret-token-123456789"},
                )
            rows = [json.loads(line) for line in logger.path.read_text(encoding="utf-8").splitlines()]
            rendered = json.dumps(rows)
            self.assertNotIn("secret-token-123456789", rendered)
            self.assertIn("[REDACTED]", rendered)


class KeyRotationTests(unittest.TestCase):
    def _bare_agent(self) -> Agent:
        agent = Agent.__new__(Agent)
        agent.settings = Settings(provider="groq")
        agent.logger = MagicMock()
        agent._active_api_key = "first-key"
        agent._init_provider = MagicMock()
        return agent

    def test_rotation_uses_the_next_untried_key(self):
        agent = self._bare_agent()
        first_fingerprint = ActivityLogger.key_fingerprint("first-key")
        with patch("missdata.agent.get_api_keys", return_value=["first-key", "second-key"]):
            rotated = agent._rotate_to_next_key({first_fingerprint})

        self.assertTrue(rotated)
        agent._init_provider.assert_called_once_with(api_key="second-key")
        self.assertTrue(agent.logger.event.called)

    def test_rotation_returns_false_when_pool_is_exhausted(self):
        agent = self._bare_agent()
        tried = {
            ActivityLogger.key_fingerprint("first-key"),
            ActivityLogger.key_fingerprint("second-key"),
        }
        with patch("missdata.agent.get_api_keys", return_value=["first-key", "second-key"]):
            self.assertFalse(agent._rotate_to_next_key(tried))
        agent._init_provider.assert_not_called()


class ProviderConsentTests(unittest.TestCase):
    def _bare_agent(self, interactive: bool) -> Agent:
        agent = Agent.__new__(Agent)
        agent.settings = Settings(provider="openai")
        agent.settings.fallback_providers = ["groq"]
        agent.logger = MagicMock()
        agent.allow_provider_switch_prompt = interactive
        agent._tool_calls_completed = 0
        return agent

    def test_provider_change_requires_affirmative_answer(self):
        agent = self._bare_agent(interactive=True)
        with patch("builtins.input", return_value="y"):
            chosen = agent._ask_provider_failover(
                "openai", ProviderError("OpenAI is unavailable"), ["groq"],
            )
        self.assertEqual("groq", chosen)
        event_args = agent.logger.event.call_args_list[-1]
        self.assertEqual("provider_switch_prompt", event_args.args[0])
        self.assertTrue(event_args.kwargs["approved"])

    def test_non_interactive_mode_never_switches_provider(self):
        agent = self._bare_agent(interactive=False)
        with patch("builtins.input") as prompt:
            chosen = agent._ask_provider_failover(
                "openai", ProviderError("OpenAI is unavailable"), ["groq"],
            )
        self.assertIsNone(chosen)
        prompt.assert_not_called()
        self.assertEqual("provider_switch_not_prompted", agent.logger.event.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
