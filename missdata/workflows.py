"""Local-first workflow primitives for project awareness, Git safety, and updates."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


_SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", "dist", "build"}
TRUSTED_UPDATE_REMOTE = "https://github.com/RootedMani/Miss-Data.git"


def missdata_root() -> str:
    """Return the source checkout that contains the currently running package."""
    return str(Path(__file__).resolve().parents[1])


def _normalized_remote(url: str) -> str:
    return url.strip().rstrip("/").removesuffix(".git").lower()


def trusted_update_remote(cwd: str, remote: str = "origin") -> tuple[bool, str]:
    if not is_git_repository(cwd):
        return False, "Miss Data is not installed from a Git repository, so self-update is unavailable."
    try:
        result = _run(["git", "remote", "get-url", remote], cwd)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if result.returncode:
        return False, f"No '{remote}' remote is configured."
    url = result.stdout.strip()
    if _normalized_remote(url) != _normalized_remote(TRUSTED_UPDATE_REMOTE):
        return False, "Self-update is blocked because the configured remote is not the trusted Miss Data repository."
    return True, url


@dataclass(frozen=True)
class TestSuggestion:
    command: str
    reason: str


def _run(argv: list[str], cwd: str, timeout: int = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=False)


def _safe_names(root: Path, limit: int = 14) -> list[str]:
    names: list[str] = []
    try:
        for child in sorted(root.iterdir(), key=lambda item: item.name.lower()):
            if child.name in _SKIP_DIRS or child.name.startswith(".") and child.name != ".env.example":
                continue
            names.append(child.name + ("/" if child.is_dir() else ""))
            if len(names) >= limit:
                break
    except OSError:
        pass
    return names


def project_map(cwd: str) -> str:
    """Build a compact project map from local files; never calls a model."""
    root = Path(cwd).resolve()
    manifests = [name for name in ("pyproject.toml", "requirements.txt", "package.json", "Cargo.toml", "go.mod", "pom.xml", "Makefile", "docker-compose.yml") if (root / name).exists()]
    languages: list[str] = []
    extensions = {
        "Python": ("*.py",), "JavaScript/TypeScript": ("*.js", "*.ts", "*.tsx"),
        "Rust": ("*.rs",), "Go": ("*.go",), "Java": ("*.java",), "C/C++": ("*.c", "*.cpp", "*.h"),
    }
    for label, patterns in extensions.items():
        if any(root.rglob(pattern) for pattern in patterns):
            languages.append(label)
    entries = [name for name in ("main.py", "app.py", "manage.py", "run.py", "server.py", "index.js", "index.ts", "src/main.rs", "main.go") if (root / name).exists()]
    test_dirs = [name for name in ("tests", "test", "spec", "__tests__") if (root / name).is_dir()]
    lines = [f"Project: {root}", f"Top-level: {', '.join(_safe_names(root)) or '(empty)'}"]
    lines.append("Manifests: " + (", ".join(manifests) if manifests else "none detected"))
    lines.append("Languages: " + (", ".join(languages) if languages else "not detected"))
    lines.append("Entry points: " + (", ".join(entries) if entries else "not detected"))
    lines.append("Test directories: " + (", ".join(test_dirs) if test_dirs else "not detected"))
    suggestions = discover_tests(cwd)
    if suggestions:
        lines.append("Suggested test: " + suggestions[0].command)
    return "\n".join(lines)


def discover_tests(cwd: str) -> list[TestSuggestion]:
    """Infer safe, common test commands from local project markers."""
    root = Path(cwd)
    suggestions: list[TestSuggestion] = []
    if (root / "pyproject.toml").exists() or (root / "pytest.ini").exists() or (root / "tests").is_dir():
        if any(root.rglob("test_*.py")) or any(root.rglob("*_test.py")):
            suggestions.append(TestSuggestion("python -m unittest discover", "Python test files detected"))
    if (root / "package.json").exists():
        try:
            package = json.loads((root / "package.json").read_text(encoding="utf-8"))
            scripts = package.get("scripts", {}) if isinstance(package, dict) else {}
            if "test" in scripts:
                suggestions.append(TestSuggestion("npm test", "package.json test script detected"))
            elif (root / "node_modules").exists():
                suggestions.append(TestSuggestion("npx jest", "Node project detected"))
        except (OSError, json.JSONDecodeError):
            pass
    if (root / "Cargo.toml").exists():
        suggestions.append(TestSuggestion("cargo test", "Cargo project detected"))
    if (root / "go.mod").exists():
        suggestions.append(TestSuggestion("go test ./...", "Go module detected"))
    if (root / "pom.xml").exists():
        suggestions.append(TestSuggestion("mvn test", "Maven project detected"))
    return suggestions


def estimate_context(messages: Iterable[dict]) -> tuple[int, int]:
    """Return a transparent character-based, not provider-exact, context estimate."""
    chars = sum(len(str(message.get("content", ""))) for message in messages)
    # A practical cross-language rough estimate; clearly label it as approximate.
    return chars, max(1, (chars + 3) // 4)


def is_git_repository(cwd: str) -> bool:
    if not shutil.which("git"):
        return False
    try:
        return _run(["git", "rev-parse", "--is-inside-work-tree"], cwd).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def git_diff(cwd: str, revision: str = "") -> tuple[bool, str]:
    """Return a bounded unified diff for the worktree or one revision comparison."""
    if not is_git_repository(cwd):
        return False, "Not inside a Git repository."
    argv = ["git", "diff", "--stat"] if not revision else ["git", "diff", "--stat", revision]
    try:
        stat = _run(argv, cwd)
        full_argv = ["git", "diff", "--", "."] if not revision else ["git", "diff", revision, "--", "."]
        full = _run(full_argv, cwd)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if stat.returncode or full.returncode:
        return False, (stat.stderr + full.stderr).strip() or "Git diff failed."
    text = (stat.stdout.strip() + "\n\n" + full.stdout.strip()).strip()
    if not text:
        return True, "No diff to show."
    limit = 24_000
    if len(text) > limit:
        text = text[:limit] + f"\n\n… diff truncated after {limit:,} characters."
    return True, text


def git_checkpoint(cwd: str, name: str) -> tuple[bool, str]:
    """Create a local checkpoint commit after user confirmation at the CLI layer."""
    if not is_git_repository(cwd):
        return False, "Not inside a Git repository."
    label = name.strip() or "Miss Data checkpoint"
    try:
        add = _run(["git", "add", "-A"], cwd)
        if add.returncode:
            return False, add.stderr.strip() or "Git could not stage changes."
        commit = _run(["git", "commit", "-m", f"missdata checkpoint: {label}"], cwd)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if commit.returncode:
        output = (commit.stdout + commit.stderr).strip()
        if "nothing to commit" in output.lower():
            return False, "Nothing to checkpoint; the working tree is clean."
        return False, output or "Git commit failed."
    head = _run(["git", "rev-parse", "--short", "HEAD"], cwd)
    return True, f"Checkpoint created at {head.stdout.strip()}: {label}"


def git_recent_checkpoints(cwd: str, limit: int = 10) -> list[tuple[str, str]]:
    if not is_git_repository(cwd):
        return []
    try:
        result = _run(["git", "log", f"-n{limit}", "--format=%h%x09%s"], cwd)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [tuple(line.split("\t", 1)) for line in result.stdout.splitlines() if "\t" in line]


def git_restore_checkpoint(cwd: str, revision: str) -> tuple[bool, str]:
    """Restore a verified revision; callers must confirm because it changes files."""
    if not is_git_repository(cwd):
        return False, "Not inside a Git repository."
    if not revision or any(char.isspace() for char in revision):
        return False, "A single Git revision is required."
    try:
        verified = _run(["git", "rev-parse", "--verify", f"{revision}^{{commit}}"], cwd)
        if verified.returncode:
            return False, "Checkpoint revision was not found."
        result = _run(["git", "reset", "--hard", revision], cwd)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    return (result.returncode == 0, (result.stdout + result.stderr).strip() or f"Restored {revision}.")


def update_status(cwd: str, remote: str = "origin") -> tuple[bool, str]:
    """Fetch trusted metadata and compare the current checkout to its configured remote."""
    trusted, remote_detail = trusted_update_remote(cwd, remote)
    if not trusted:
        return False, remote_detail
    try:
        fetch = _run(["git", "fetch", remote, "--quiet"], cwd, timeout=45)
        if fetch.returncode:
            return False, fetch.stderr.strip() or "Could not fetch update metadata."
        branch = _run(["git", "branch", "--show-current"], cwd).stdout.strip()
        if not branch:
            return False, "Self-update requires a named Git branch, not detached HEAD."
        counts = _run(["git", "rev-list", "--left-right", "--count", f"HEAD...{remote}/{branch}"], cwd)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    if counts.returncode:
        return False, counts.stderr.strip() or "Could not compare the configured branch."
    behind, ahead = (int(value) for value in counts.stdout.split())
    return True, f"Trusted remote: {remote_detail}\nBranch: {branch}\nUpdates available: {behind}; local-only commits: {ahead}."


def apply_update(cwd: str, remote: str = "origin") -> tuple[bool, str]:
    """Fast-forward only: never merges or overwrites local changes automatically."""
    trusted, remote_detail = trusted_update_remote(cwd, remote)
    if not trusted:
        return False, remote_detail
    try:
        status = _run(["git", "status", "--porcelain"], cwd)
        if status.stdout.strip():
            return False, "Update stopped: the Miss Data working tree has local changes. Commit, stash, or discard them first."
        branch = _run(["git", "branch", "--show-current"], cwd).stdout.strip()
        if not branch:
            return False, "Update stopped: detached HEAD is not supported."
        result = _run(["git", "pull", "--ff-only", remote, branch], cwd, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)
    return (result.returncode == 0, (result.stdout + result.stderr).strip())
