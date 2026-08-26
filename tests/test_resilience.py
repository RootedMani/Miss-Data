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
from missdata.ollama_recovery import OllamaRepairResult, diagnose_ollama_error, is_loopback_url
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


class _ContextRecoveryProvider:
    def __init__(self):
        self.main_requests = 0
        self.summary_requests = 0

    def make_system_message(self, content: str) -> dict:
        return {"role": "system", "content": content}

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    def stream_turn(self, messages: list[dict], tool_schemas: list[dict]):
        if not tool_schemas:
            self.summary_requests += 1
            from missdata.providers import StreamResult
            return StreamResult(text="Previous task: inspect the repository.")
        self.main_requests += 1
        if self.main_requests == 1:
            raise ProviderError(
                "Groq API error: Error code: 413 - request too large on tokens per minute (TPM)"
            )
        from missdata.providers import StreamResult
        return StreamResult(text="Recovered answer")

    def append_assistant_turn(self, messages: list[dict], result) -> None:
        messages.append({"role": "assistant", "content": result.text})


class ContextRecoveryTests(unittest.TestCase):
    def _agent_with_history(self) -> tuple[Agent, _ContextRecoveryProvider]:
        provider = _ContextRecoveryProvider()
        agent = Agent.__new__(Agent)
        agent.settings = Settings(provider="groq", context_recovery="auto")
        agent.cwd = os.getcwd()
        agent.sandbox_root = agent.cwd
        agent.messages = [
            {"role": "system", "content": "system"},
            provider.make_user_message("Earlier request"),
            {"role": "assistant", "content": "Earlier answer"},
        ]
        agent.always_approved = set()
        agent._touched_files = set()
        agent.logger = MagicMock()
        agent._provider = provider
        agent._active_api_key = "test-key"
        agent._spinner = MagicMock()
        agent._marker_shown = False
        agent._suppress_stream_output = False
        agent._tool_calls_completed = 0
        agent.allow_provider_switch_prompt = True
        return agent, provider

    def test_detects_groq_413_request_too_large(self):
        self.assertTrue(Agent._is_context_limit_error(ProviderError(
            "Groq API error: Error code: 413 - Request too large on tokens per minute (TPM)"
        )))
        self.assertFalse(Agent._is_context_limit_error(ProviderError("Groq rejected the API key (401)")))

    def test_auto_compacts_and_retries_before_key_or_provider_failover(self):
        agent, provider = self._agent_with_history()
        with patch("missdata.agent.ui.print_agent_marker"), patch("missdata.agent.ui.print_info"):
            agent.run_turn("Current request")

        self.assertEqual(2, provider.main_requests)
        self.assertEqual(1, provider.summary_requests)
        self.assertTrue(any(
            call.args[0] == "context_recovered" for call in agent.logger.event.call_args_list
        ))
        self.assertTrue(any(
            message.get("content") == "Recovered answer" for message in agent.messages
        ))

    def test_non_context_errors_do_not_offer_compaction(self):
        agent, _ = self._agent_with_history()
        agent.settings.context_recovery = "auto"
        self.assertFalse(agent._recover_from_context_limit(ProviderError("Groq rejected the API key (401)")))


class OllamaRecoveryTests(unittest.TestCase):
    def _bare_agent(self, mode: str = "auto") -> Agent:
        agent = Agent.__new__(Agent)
        agent.settings = Settings(provider="ollama", ollama_model="gemma4:e4b", ollama_recovery=mode)
        agent.logger = MagicMock()
        agent.allow_provider_switch_prompt = True
        return agent

    def test_classifies_connection_and_model_errors(self):
        self.assertEqual(
            "connection",
            diagnose_ollama_error(ProviderError("Could not reach Ollama at http://localhost:11434 (<urlopen error [Errno 111] Connection refused>)")).kind,
        )
        self.assertEqual(
            "model_missing",
            diagnose_ollama_error(ProviderError("Ollama returned 404 for model 'gemma4:e4b'. It likely isn't pulled yet")).kind,
        )
        self.assertEqual("unknown", diagnose_ollama_error(ProviderError("Ollama HTTP error 500")).kind)

    def test_server_start_is_limited_to_loopback_urls(self):
        self.assertTrue(is_loopback_url("http://localhost:11434"))
        self.assertTrue(is_loopback_url("http://127.0.0.1:11434"))
        self.assertFalse(is_loopback_url("http://ollama.example.com:11434"))

    def test_auto_mode_runs_approved_connection_repair(self):
        agent = self._bare_agent(mode="auto")
        result = OllamaRepairResult(True, "server_started", "Started Ollama and confirmed it is reachable.")
        error = ProviderError("Could not reach Ollama at http://localhost:11434 (<urlopen error [Errno 111] Connection refused>)")
        with patch("missdata.agent.repair_ollama", return_value=result) as repair, patch("missdata.agent.ui.print_info"):
            self.assertTrue(agent._recover_from_ollama_failure(error))
        repair.assert_called_once()
        self.assertTrue(any(
            call.args[0] == "ollama_repair_completed" for call in agent.logger.event.call_args_list
        ))

    def test_ask_mode_requires_user_approval(self):
        agent = self._bare_agent(mode="ask")
        error = ProviderError("Could not reach Ollama at http://localhost:11434 (<urlopen error [Errno 111] Connection refused>)")
        with patch("builtins.input", return_value="n"), patch("missdata.agent.repair_ollama") as repair, patch("missdata.agent.ui.print_info"):
            self.assertFalse(agent._recover_from_ollama_failure(error))
        repair.assert_not_called()


if __name__ == "__main__":
    unittest.main()
