"""No-model-cost project and local-provider diagnostics for the CLI."""
from __future__ import annotations

import json
import shutil
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProjectChangeSummary:
    is_repository: bool
    root: str = ""
    branch: str = ""
    changed_files: int = 0
    staged_files: int = 0
    untracked_files: int = 0
    diff_stat: str = ""
    detail: str = ""


def _git(cwd: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args], cwd=cwd, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=5, check=False,
    )


def project_change_summary(cwd: str) -> ProjectChangeSummary:
    """Return a compact, read-only Git worktree summary without a shell."""
    if not shutil.which("git"):
        return ProjectChangeSummary(False, detail="Git is not installed or not available on PATH.")
    try:
        root_result = _git(cwd, "rev-parse", "--show-toplevel")
    except (OSError, subprocess.TimeoutExpired) as error:
        return ProjectChangeSummary(False, detail=f"Could not inspect Git status: {error}")
    if root_result.returncode != 0:
        return ProjectChangeSummary(False, detail="This working directory is not inside a Git repository.")

    root = root_result.stdout.strip()
    branch_result = _git(cwd, "branch", "--show-current")
    status_result = _git(cwd, "status", "--porcelain=v1")
    diff_result = _git(cwd, "diff", "--stat")
    staged_stat_result = _git(cwd, "diff", "--cached", "--stat")
    rows = [line for line in status_result.stdout.splitlines() if line]
    staged = sum(1 for line in rows if len(line) >= 1 and line[0] != " ")
    unstaged = sum(1 for line in rows if len(line) >= 2 and line[1] != " ")
    untracked = sum(1 for line in rows if line.startswith("??"))
    changed = len(rows)
    summary_parts = [part.strip() for part in (diff_result.stdout, staged_stat_result.stdout) if part.strip()]
    return ProjectChangeSummary(
        True, root=root, branch=branch_result.stdout.strip() or "detached HEAD",
        changed_files=changed, staged_files=staged, untracked_files=untracked,
        diff_stat="\n".join(summary_parts) or "No textual diff statistics available.",
        detail=f"{unstaged} unstaged change record(s).",
    )


def format_project_change_summary(summary: ProjectChangeSummary) -> str:
    if not summary.is_repository:
        return summary.detail
    lines = [
        f"Repository: {summary.root}",
        f"Branch: {summary.branch}",
        f"Changed entries: {summary.changed_files}  |  staged: {summary.staged_files}  |  untracked: {summary.untracked_files}",
        summary.detail,
    ]
    if summary.changed_files:
        lines.extend(["", "Diff statistics:", summary.diff_stat])
    else:
        lines.append("Working tree is clean.")
    return "\n".join(lines)


@dataclass(frozen=True)
class OllamaHealth:
    reachable: bool
    executable_found: bool
    model_available: bool | None
    detail: str


def ollama_health(base_url: str, model: str, timeout: float = 2.0) -> OllamaHealth:
    """Check local Ollama without generating text or downloading anything."""
    executable_found = shutil.which("ollama") is not None
    try:
        with urllib.request.urlopen(base_url.rstrip("/") + "/api/tags", timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, json.JSONDecodeError) as error:
        command_note = "found" if executable_found else "not found"
        return OllamaHealth(False, executable_found, None, f"Ollama is not reachable; `ollama` command {command_note}. ({error})")
    names = {str(item.get("name", "")) for item in payload.get("models", []) if isinstance(item, dict)}
    available = model in names
    detail = f"Ollama is reachable. Model '{model}' is " + ("available." if available else "not listed locally.")
    return OllamaHealth(True, executable_found, available, detail)
