from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock, patch

from missdata.agent import Agent, build_system_prompt
from missdata.config import Settings
from missdata.providers import GroqProvider, ProviderError, StreamResult, normalize_proxy_environment, provider_startup_error
from missdata import tools, ui


class _StatusError(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code


class _FakeDelta:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class _FakeChunk:
    def __init__(self, delta):
        self.choices = [MagicMock(delta=delta)]


class _RaisingStream:
    """A fake streamed completion: yields the given chunks, then raises
    `error` (if any) once fully consumed — mirroring how Groq's real
    streaming failures show up mid-iteration on an otherwise-200 response,
    not as an exception from the initial `.create()` call."""

    def __init__(self, chunks, error=None):
        self._chunks = chunks
        self._error = error

    def __iter__(self):
        yield from self._chunks
        if self._error is not None:
            raise self._error


class AgentFeatureTests(unittest.TestCase):
    def test_system_prompt_uses_configured_response_language(self):
        self.assertIn("Always respond in English.", build_system_prompt("/tmp", "en"))
        self.assertIn("Always respond in Persian (فارسی).", build_system_prompt("/tmp", "fa"))

    def test_groq_retries_a_403_once(self):
        provider = GroqProvider.__new__(GroqProvider)
        provider.settings = Settings()
        provider.client = MagicMock()
        error = _StatusError(403)
        provider.client.chat.completions.create.side_effect = [error, "completion"]

        with patch("missdata.providers.time.sleep") as sleep:
            completion = provider._create_completion([], [])

        self.assertEqual("completion", completion)
        self.assertEqual(2, provider.client.chat.completions.create.call_count)
        sleep.assert_called_once_with(1)

    def test_groq_explains_persistent_403(self):
        provider = GroqProvider.__new__(GroqProvider)
        provider.settings = Settings(groq_model="example-model")
        provider.client = MagicMock()
        provider.client.chat.completions.create.side_effect = _StatusError(403)

        with patch("missdata.providers.time.sleep"), self.assertRaisesRegex(
            ProviderError, "after one automatic retry.*example-model"
        ):
            provider._create_completion([], [])

    def test_web_search_uses_brave_when_key_present(self):
        response = MagicMock()
        response.read.return_value = json.dumps(
            {"web": {"results": [{"title": "Example result", "url": "https://example.com/a"}]}}
        ).encode("utf-8")
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        with patch("missdata.config.get_api_key", return_value="fake-brave-key"), patch(
            "missdata.tools.urllib.request.urlopen", return_value=response
        ):
            result = tools.web_search({"query": "example"}, ".")

        self.assertIn("Example result", result)
        self.assertIn("https://example.com/a", result)

    def test_web_search_falls_back_to_duckduckgo_without_key(self):
        response = MagicMock()
        response.status = 200
        response.read.return_value = (
            b'<a class="result__a" href="https://example.com/a">Example <b>result</b></a>'
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        with patch("missdata.config.get_api_key", return_value=None), patch(
            "missdata.tools.urllib.request.urlopen", return_value=response
        ):
            result = tools.web_search({"query": "example"}, ".")

        self.assertIn("Example result", result)
        self.assertIn("https://example.com/a", result)

    def test_web_search_duckduckgo_soft_block_raises_clear_error(self):
        response = MagicMock()
        response.status = 202
        response.read.return_value = b""
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        with patch("missdata.config.get_api_key", return_value=None), patch(
            "missdata.tools.urllib.request.urlopen", return_value=response
        ):
            with self.assertRaisesRegex(tools.ToolError, "BRAVE_API_KEY"):
                tools.web_search({"query": "example"}, ".")

    def test_web_search_is_registered_as_a_read_only_tool(self):
        self.assertIs(tools.TOOL_IMPLEMENTATIONS["web_search"], tools.web_search)
        self.assertIn("web_search", tools.READ_ONLY_TOOLS)

    def test_socks_proxy_url_is_normalized_for_httpx(self):
        with patch.dict("os.environ", {"ALL_PROXY": "socks://127.0.0.1:10808/"}, clear=True):
            normalize_proxy_environment()
            self.assertEqual("socks5://127.0.0.1:10808/", os.environ["ALL_PROXY"])

    def test_proxy_startup_error_explains_how_to_fix_socks_support(self):
        error = provider_startup_error("Groq", ValueError("Unknown scheme for proxy URL"))
        self.assertIn("httpx[socks]", str(error))
        self.assertIn("ALL_PROXY", str(error))

    def test_groq_recovers_from_a_hallucinated_tool_name(self):
        provider = GroqProvider.__new__(GroqProvider)
        provider.settings = Settings()
        provider.on_text = lambda s: None
        provider.client = MagicMock()

        bad_stream = _RaisingStream([], Exception(
            "Tool call validation failed: tool call validation failed: attempted to "
            "call tool 'repo_browser.open_file' which was not in request.tools"
        ))
        good_stream = _RaisingStream([_FakeChunk(_FakeDelta(content="Hello!"))])
        provider.client.chat.completions.create.side_effect = [bad_stream, good_stream]

        with patch("missdata.providers.ui.print_info"):
            result = provider.stream_turn([{"role": "user", "content": "hi"}], [])

        self.assertEqual("Hello!", result.text)
        self.assertEqual(2, provider.client.chat.completions.create.call_count)
        # The retry adds a corrective note naming the bad tool, without
        # mutating the caller's original message list.
        first_messages = provider.client.chat.completions.create.call_args_list[0].kwargs["messages"]
        second_messages = provider.client.chat.completions.create.call_args_list[1].kwargs["messages"]
        self.assertEqual(1, len(first_messages))
        self.assertEqual(2, len(second_messages))
        self.assertIn("repo_browser.open_file", second_messages[-1]["content"])

    def test_groq_recovers_from_malformed_tool_call_json(self):
        provider = GroqProvider.__new__(GroqProvider)
        provider.settings = Settings()
        provider.on_text = lambda s: None
        provider.client = MagicMock()

        bad_stream = _RaisingStream([], Exception("Failed to parse tool call arguments as JSON"))
        good_stream = _RaisingStream([_FakeChunk(_FakeDelta(content="Fixed it."))])
        provider.client.chat.completions.create.side_effect = [bad_stream, good_stream]

        with patch("missdata.providers.ui.print_info"):
            result = provider.stream_turn([{"role": "user", "content": "hi"}], [])

        self.assertEqual("Fixed it.", result.text)
        self.assertEqual(2, provider.client.chat.completions.create.call_count)

    def test_groq_gives_up_after_repeated_generation_failures(self):
        provider = GroqProvider.__new__(GroqProvider)
        provider.settings = Settings()
        provider.on_text = lambda s: None
        provider.client = MagicMock()

        always_bad = Exception("Failed to parse tool call arguments as JSON")
        provider.client.chat.completions.create.side_effect = [
            _RaisingStream([], always_bad) for _ in range(5)
        ]

        with patch("missdata.providers.ui.print_info"), self.assertRaises(ProviderError):
            provider.stream_turn([{"role": "user", "content": "hi"}], [])

        # 1 initial attempt + 2 retries = 3 total calls, then it gives up
        # rather than retrying forever.
        self.assertEqual(3, provider.client.chat.completions.create.call_count)

    def test_groq_does_not_retry_unrelated_mid_stream_errors(self):
        provider = GroqProvider.__new__(GroqProvider)
        provider.settings = Settings()
        provider.on_text = lambda s: None
        provider.client = MagicMock()

        provider.client.chat.completions.create.return_value = _RaisingStream(
            [], Exception("connection reset by peer")
        )

        with self.assertRaises(ProviderError):
            provider.stream_turn([{"role": "user", "content": "hi"}], [])

        # An error unrelated to the known gpt-oss glitches must not be
        # retried — retrying blindly would mask real bugs/outages.
        self.assertEqual(1, provider.client.chat.completions.create.call_count)


class OpenAICompatibleProviderTests(unittest.TestCase):
    @staticmethod
    def _fake_sse_response(lines: list[bytes]):
        class _FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def __iter__(self):
                return iter(lines)

        return _FakeResp()

    def test_streams_text_and_accumulates_tool_call(self):
        from missdata.providers import OpenAICompatibleProvider

        lines = [
            b'data: {"choices":[{"delta":{"content":"Hello "}}]}\n',
            b'data: {"choices":[{"delta":{"content":"world"}}]}\n',
            b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",'
            b'"function":{"name":"web_search","arguments":"{\\"q\\""}}]}}]}\n',
            b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
            b'"function":{"arguments":": 1}"}}]}}]}\n',
            b"data: [DONE]\n",
        ]
        settings = Settings()
        settings.provider = "deepseek"
        with patch("missdata.providers.get_api_key", return_value="fake-key"), patch(
            "urllib.request.urlopen", return_value=self._fake_sse_response(lines)
        ):
            provider = OpenAICompatibleProvider(settings)
            result = provider.stream_turn([{"role": "user", "content": "hi"}], [])

        self.assertEqual("Hello world", result.text)
        self.assertEqual(1, len(result.tool_calls))
        self.assertEqual("web_search", result.tool_calls[0].name)
        self.assertEqual('{"q": 1}', result.tool_calls[0].arguments)

    def test_missing_api_key_raises_clear_error(self):
        from missdata.providers import OpenAICompatibleProvider

        settings = Settings()
        settings.provider = "deepseek"
        with patch("missdata.providers.get_api_key", return_value=None):
            with self.assertRaisesRegex(ProviderError, "DEEPSEEK_API_KEY"):
                OpenAICompatibleProvider(settings)

    def test_custom_provider_requires_base_url(self):
        from missdata.providers import OpenAICompatibleProvider

        settings = Settings()
        settings.provider = "custom"
        with self.assertRaisesRegex(ProviderError, "base URL"):
            OpenAICompatibleProvider(settings)

    def test_custom_provider_uses_configured_base_url_and_model(self):
        from missdata.providers import OpenAICompatibleProvider

        lines = [b'data: {"choices":[{"delta":{"content":"hi"}}]}\n', b"data: [DONE]\n"]
        settings = Settings()
        settings.provider = "custom"
        settings.custom_base_url = "https://my-llm.example.com/v1"
        settings.custom_model = "my-model"
        with patch("missdata.providers.get_api_key", return_value="fake-key") as mock_get_key, patch(
            "urllib.request.urlopen", return_value=self._fake_sse_response(lines)
        ) as mock_urlopen:
            provider = OpenAICompatibleProvider(settings)
            provider.stream_turn([{"role": "user", "content": "hi"}], [])

        mock_get_key.assert_called_with("custom")
        request = mock_urlopen.call_args[0][0]
        self.assertEqual("https://my-llm.example.com/v1/chat/completions", request.full_url)
        body = json.loads(request.data.decode("utf-8"))
        self.assertEqual("my-model", body["model"])

    def test_make_provider_dispatches_openai_compatible_presets(self):
        from missdata.providers import make_provider

        settings = Settings()
        settings.provider = "openrouter"
        with patch("missdata.providers.get_api_key", return_value="fake-key"):
            provider = make_provider(settings)
        self.assertEqual("openrouter", provider.name)
        self.assertEqual("https://openrouter.ai/api/v1", provider.base_url)


class _FakeCompactProvider:
    """Minimal OpenAI-shaped provider stand-in for exercising Agent.compact_context
    without a real network call or SDK."""

    def __init__(self, summary_text: str = "SUMMARY: did X, next step is Y."):
        self.summary_text = summary_text
        self.seen_request_messages: list[dict] | None = None

    def make_system_message(self, content: str) -> dict:
        return {"role": "system", "content": content}

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    def stream_turn(self, messages: list[dict], tool_schemas: list[dict]) -> StreamResult:
        self.seen_request_messages = messages
        return StreamResult(text=self.summary_text)


def _make_test_agent(fake_provider: _FakeCompactProvider) -> Agent:
    agent = Agent.__new__(Agent)
    agent.settings = Settings()
    agent.settings.provider = "groq"  # any non-"anthropic" value takes the generic message path
    agent.cwd = os.getcwd()
    agent.sandbox_root = agent.cwd
    agent.messages = []
    agent.always_approved = set()
    agent._touched_files = set()
    agent._provider = fake_provider
    agent._spinner = MagicMock()
    agent._marker_shown = False
    agent._reset_system_message()
    return agent


class CompactContextTests(unittest.TestCase):
    def test_raises_when_not_enough_conversation(self):
        agent = _make_test_agent(_FakeCompactProvider())
        agent.messages.append(agent._provider.make_user_message("hi"))
        with self.assertRaises(ValueError):
            agent.compact_context()

    def test_folds_whole_conversation_into_one_summary_by_default(self):
        fake = _FakeCompactProvider("SUMMARY: built the feature.")
        agent = _make_test_agent(fake)
        agent.messages.append(agent._provider.make_user_message("do task A"))
        agent.messages.append({"role": "assistant", "content": "done with A"})
        agent.messages.append(agent._provider.make_user_message("do task B"))
        agent.messages.append({"role": "assistant", "content": "done with B"})

        stats = agent.compact_context()

        self.assertEqual(4, stats["before"])
        self.assertEqual(1, stats["after"])
        self.assertEqual(0, stats["kept_turns"])
        non_system = [m for m in agent.messages if m.get("role") != "system"]
        self.assertEqual(1, len(non_system))
        self.assertIn("SUMMARY: built the feature.", non_system[0]["content"])
        # System message must survive compaction.
        self.assertTrue(any(m.get("role") == "system" for m in agent.messages))

    def test_keeps_recent_turns_verbatim(self):
        fake = _FakeCompactProvider("SUMMARY: earlier stuff.")
        agent = _make_test_agent(fake)
        agent.messages.append(agent._provider.make_user_message("turn 1"))
        agent.messages.append({"role": "assistant", "content": "reply 1"})
        agent.messages.append(agent._provider.make_user_message("turn 2"))
        agent.messages.append({"role": "assistant", "content": "reply 2"})
        agent.messages.append(agent._provider.make_user_message("turn 3"))
        agent.messages.append({"role": "assistant", "content": "reply 3"})

        stats = agent.compact_context(keep_recent_turns=1)

        self.assertEqual(1, stats["kept_turns"])
        non_system = [m for m in agent.messages if m.get("role") != "system"]
        # 1 summary message + the last turn's 2 messages (user + assistant)
        self.assertEqual(3, len(non_system))
        self.assertIn("SUMMARY: earlier stuff.", non_system[0]["content"])
        self.assertEqual("turn 3", non_system[1]["content"])
        self.assertEqual("reply 3", non_system[2]["content"])
        # Only turns 1 and 2 were sent to be summarized — not turn 3.
        summarized_texts = [m.get("content") for m in fake.seen_request_messages]
        self.assertIn("turn 1", summarized_texts)
        self.assertIn("turn 2", summarized_texts)
        self.assertNotIn("turn 3", summarized_texts)

    def test_keep_recent_turns_clamped_to_available_turns(self):
        fake = _FakeCompactProvider("SUMMARY.")
        agent = _make_test_agent(fake)
        agent.messages.append(agent._provider.make_user_message("turn 1"))
        agent.messages.append({"role": "assistant", "content": "reply 1"})
        agent.messages.append(agent._provider.make_user_message("turn 2"))
        agent.messages.append({"role": "assistant", "content": "reply 2"})

        # Asking to keep more turns than exist should still summarize at
        # least the oldest one, not silently keep everything (i.e. no-op).
        stats = agent.compact_context(keep_recent_turns=99)
        self.assertEqual(1, stats["kept_turns"])

    def test_empty_summary_raises_provider_error(self):
        fake = _FakeCompactProvider(summary_text="   ")
        agent = _make_test_agent(fake)
        agent.messages.append(agent._provider.make_user_message("turn 1"))
        agent.messages.append({"role": "assistant", "content": "reply 1"})
        agent.messages.append(agent._provider.make_user_message("turn 2"))
        agent.messages.append({"role": "assistant", "content": "reply 2"})

        with self.assertRaises(ProviderError):
            agent.compact_context()


if __name__ == "__main__":
    unittest.main()
