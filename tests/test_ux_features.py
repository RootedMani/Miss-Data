"""Tests for budget-conscious and no-model-cost CLI features."""
from __future__ import annotations

import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from missdata.cli import handle_slash_command
from missdata.config import BUDGET_PROFILES, Settings
from missdata.insights import ProjectChangeSummary, format_project_change_summary, project_change_summary


class BudgetCommandTests(unittest.TestCase):
    def _agent(self):
        return SimpleNamespace(logger=MagicMock(), cwd="/tmp", sandbox_root="/tmp")

    def test_named_budget_profile_updates_output_cap(self):
        settings = Settings()
        agent = self._agent()
        with patch.object(settings, "save"), patch("missdata.cli.ui.print_info"):
            self.assertTrue(handle_slash_command("/budget economy", agent, settings))
        self.assertEqual("economy", settings.budget_profile)
        self.assertEqual(BUDGET_PROFILES["economy"], settings.max_output_tokens)
        self.assertEqual("budget_profile_updated", agent.logger.event.call_args.args[0])

    def test_custom_budget_cap_is_bounded(self):
        settings = Settings()
        agent = self._agent()
        with patch.object(settings, "save"), patch("missdata.cli.ui.print_info"):
            handle_slash_command("/budget 1024", agent, settings)
        self.assertEqual("custom", settings.budget_profile)
        self.assertEqual(1024, settings.max_output_tokens)

    def test_invalid_budget_does_not_change_setting(self):
        settings = Settings(max_output_tokens=2048, budget_profile="balanced")
        agent = self._agent()
        with patch.object(settings, "save") as save, patch("missdata.cli.ui.print_error"):
            handle_slash_command("/budget 10", agent, settings)
        save.assert_not_called()
        self.assertEqual("balanced", settings.budget_profile)
        self.assertEqual(2048, settings.max_output_tokens)


class ProjectInsightsTests(unittest.TestCase):
    def test_non_repository_has_clear_diagnostic(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = project_change_summary(directory)
        self.assertFalse(summary.is_repository)
        self.assertTrue(summary.detail)

    def test_formatter_includes_useful_git_fields(self):
        summary = ProjectChangeSummary(
            True, root="/repo", branch="main", changed_files=2,
            staged_files=1, untracked_files=1, diff_stat="2 files changed", detail="1 unstaged change record(s).",
        )
        text = format_project_change_summary(summary)
        self.assertIn("Repository: /repo", text)
        self.assertIn("Branch: main", text)
        self.assertIn("Changed entries: 2", text)
        self.assertIn("2 files changed", text)


if __name__ == "__main__":
    unittest.main()
