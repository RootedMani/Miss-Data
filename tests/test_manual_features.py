"""Tests for the in-program manual and model capability reference."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from missdata.agent import build_system_prompt
from missdata.cli import _show_manual
from missdata.manual import capability_reference, lookup, search


class ManualFeatureTests(unittest.TestCase):
    def test_lookup_accepts_command_and_alias(self):
        self.assertEqual("keys", lookup("/keys").name)
        self.assertEqual("update", lookup("upgrade").name)

    def test_search_finds_relevant_manual_topics(self):
        matches = search("ollama rate-limit")
        names = {page.name for page in matches}
        self.assertIn("resilience", names)

    def test_system_prompt_contains_generated_capability_reference(self):
        prompt = build_system_prompt("/tmp", "en")
        self.assertIn("Miss Data capability reference", prompt)
        self.assertIn("/update [check|apply]", prompt)
        self.assertIn("/man <topic>", prompt)

    def test_manual_rendering_is_available_without_model_call(self):
        with patch("builtins.print") as output:
            _show_manual("keys")
        rendered = "\n".join(str(call.args) for call in output.call_args_list)
        self.assertIn("KEYS", rendered)
        self.assertIn("/keys", rendered)

    def test_capability_reference_mentions_read_only_review(self):
        reference = capability_reference()
        self.assertIn("read-only", reference)
        self.assertIn("/review [path]", reference)


if __name__ == "__main__":
    unittest.main()
