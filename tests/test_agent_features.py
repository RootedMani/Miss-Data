from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from missdata.agent import build_system_prompt
from missdata.config import Settings
from missdata.providers import GroqProvider, ProviderError
from missdata import tools


class _StatusError(Exception):
    def __init__(self, status_code: int):
        self.status_code = status_code


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

    def test_web_search_parses_result_links(self):
        response = MagicMock()
        response.read.return_value = (
            b'<a class="result__a" href="https://example.com/a">Example <b>result</b></a>'
        )
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        with patch("missdata.tools.urllib.request.urlopen", return_value=response):
            result = tools.web_search({"query": "example"}, ".")

        self.assertIn("Example result", result)
        self.assertIn("https://example.com/a", result)

    def test_web_search_is_registered_as_a_read_only_tool(self):
        self.assertIs(tools.TOOL_IMPLEMENTATIONS["web_search"], tools.web_search)
        self.assertIn("web_search", tools.READ_ONLY_TOOLS)


if __name__ == "__main__":
    unittest.main()
