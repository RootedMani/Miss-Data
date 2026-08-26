"""
Tool implementations available to Miss Data.

Every tool function takes `(args: dict, cwd: str, *, sandbox_root, sandbox_enabled)`
and returns a string result (what gets fed back to the model). Tools that
touch the filesystem or run shell commands are marked RISKY and go through
the approval system in agent.py before executing.

When `sandbox_enabled` is True (the default), filesystem tools are confined
to `sandbox_root` and shell/python execution goes through the deny-list +
resource limits in `sandbox.py`. See sandbox.py for what that does and does
not protect against.
"""

from __future__ import annotations

import difflib
import fnmatch
import html
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from . import sandbox

MAX_READ_BYTES = 20_000       # guard against dumping huge files into context
MAX_OUTPUT_CHARS = 20_000      # guard against runaway shell output
SHELL_TIMEOUT_SECS = 60
MAX_SEARCH_RESULTS = 200
MAX_GREP_RESULTS = 300
MAX_GREP_FILES_SCANNED = 2000

# Tool names considered "risky" -> require approval unless mode == auto
RISKY_TOOLS = {"write_file", "edit_file", "delete_path", "run_command", "make_dir", "move_path", "run_python", "update_missdata"}
READ_ONLY_TOOLS = {"read_file", "list_dir", "search_files", "grep", "get_cwd", "which", "web_search"}

# Tools that mutate the filesystem, and which of their args are the affected
# path(s) — used by agent.py to build a "files touched this turn" summary.
FILE_MUTATION_ARGS = {
    "write_file": ("path",),
    "edit_file": ("path",),
    "delete_path": ("path",),
    "move_path": ("src", "dst"),
    "make_dir": ("path",),
}


class ToolError(Exception):
    pass


def _resolve(path: str, cwd: str, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> Path:
    """Resolve a possibly-relative path against the agent's working directory.

    When sandboxing is enabled, the resolved path is also required to stay
    inside `sandbox_root` (see sandbox.py) — this *is* a hard boundary, not
    just a convenience. With sandboxing disabled this behaves like the old,
    unrestricted resolution (still normalizes the path, just doesn't fence it).
    """
    if sandbox_enabled and sandbox_root:
        try:
            return sandbox.resolve_in_sandbox(path, cwd, sandbox_root)
        except sandbox.SandboxViolation as e:
            raise ToolError(str(e)) from e

    p = Path(path).expanduser()
    if not p.is_absolute():
        p = Path(cwd) / p
    return p.resolve()


def resolve_display(path: str, cwd: str, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    """Like _resolve, but never raises — used for cosmetic purposes (e.g.
    building the 'files touched' summary) where a best-effort path beats
    crashing the summary over an edge case."""
    try:
        return str(_resolve(path, cwd, sandbox_root, sandbox_enabled))
    except ToolError:
        p = Path(path).expanduser()
        if not p.is_absolute():
            p = Path(cwd) / p
        return str(p)


def _truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= limit:
        return text
    half = limit // 2
    return (
        text[:half]
        + f"\n\n... [truncated {len(text) - limit} chars] ...\n\n"
        + text[-half:]
    )


# ---------------------------------------------------------------------------
# Filesystem tools
# ---------------------------------------------------------------------------

def read_file(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    path = _resolve(args["path"], cwd, sandbox_root, sandbox_enabled)
    if not path.exists():
        raise ToolError(f"File not found: {path}")
    if path.is_dir():
        raise ToolError(f"{path} is a directory, not a file. Use list_dir instead.")

    start_line = args.get("start_line")
    end_line = args.get("end_line")

    data = path.read_bytes()
    if len(data) > MAX_READ_BYTES and not (start_line or end_line):
        raise ToolError(
            f"File is {len(data)} bytes, too large to read fully. "
            f"Use start_line/end_line to read a slice."
        )

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return f"[binary file, {len(data)} bytes — cannot display as text]"

    if start_line or end_line:
        lines = text.splitlines()
        s = max((start_line or 1) - 1, 0)
        e = end_line or len(lines)
        sliced = lines[s:e]
        numbered = [f"{s + i + 1:>5}\t{line}" for i, line in enumerate(sliced)]
        return "\n".join(numbered)

    lines = text.splitlines()
    numbered = [f"{i + 1:>5}\t{line}" for i, line in enumerate(lines)]
    return "\n".join(numbered)


def write_file(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    path = _resolve(args["path"], cwd, sandbox_root, sandbox_enabled)
    content = args.get("content", "")
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.exists()
    path.write_text(content, encoding="utf-8")
    action = "Overwrote" if existed else "Created"
    return f"{action} {path} ({len(content)} chars, {content.count(chr(10)) + 1} lines)"


def edit_file(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    """Find-and-replace a unique string in a file (like a scoped patch)."""
    path = _resolve(args["path"], cwd, sandbox_root, sandbox_enabled)
    if not path.exists():
        raise ToolError(f"File not found: {path}")

    old_str = args["old_str"]
    new_str = args.get("new_str", "")

    text = path.read_text(encoding="utf-8")
    count = text.count(old_str)
    if count == 0:
        raise ToolError("old_str was not found in the file. No changes made.")
    if count > 1:
        raise ToolError(
            f"old_str appears {count} times in the file — it must be unique. "
            f"Include more surrounding context to disambiguate."
        )

    new_text = text.replace(old_str, new_str, 1)
    path.write_text(new_text, encoding="utf-8")

    diff = "\n".join(
        difflib.unified_diff(
            text.splitlines(), new_text.splitlines(),
            fromfile=str(path), tofile=str(path), lineterm="",
        )
    )
    return f"Edited {path}.\n{_truncate(diff, 3000)}"


def delete_path(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    path = _resolve(args["path"], cwd, sandbox_root, sandbox_enabled)
    if not path.exists():
        raise ToolError(f"Path not found: {path}")
    if path.is_dir():
        shutil.rmtree(path)
        return f"Deleted directory {path}"
    path.unlink()
    return f"Deleted file {path}"


def move_path(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    src = _resolve(args["src"], cwd, sandbox_root, sandbox_enabled)
    dst = _resolve(args["dst"], cwd, sandbox_root, sandbox_enabled)
    if not src.exists():
        raise ToolError(f"Source not found: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    # shutil.move (not Path.rename) so this also works when src/dst land on
    # different filesystems, e.g. an OS temp dir mounted separately from cwd.
    shutil.move(str(src), str(dst))
    return f"Moved {src} -> {dst}"


def make_dir(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    path = _resolve(args["path"], cwd, sandbox_root, sandbox_enabled)
    path.mkdir(parents=True, exist_ok=True)
    return f"Ensured directory exists: {path}"


def list_dir(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    path = _resolve(args.get("path", "."), cwd, sandbox_root, sandbox_enabled)
    if not path.exists():
        raise ToolError(f"Path not found: {path}")
    if not path.is_dir():
        raise ToolError(f"{path} is not a directory.")

    max_depth = int(args.get("max_depth", 2))
    ignore = {".git", "__pycache__", "node_modules", "venv", ".venv", ".mypy_cache", ".pytest_cache"}

    lines = []

    def walk(p: Path, depth: int, prefix: str):
        if depth > max_depth:
            return
        try:
            entries = sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
        except PermissionError:
            lines.append(f"{prefix}[permission denied]")
            return
        for entry in entries:
            if entry.name in ignore:
                continue
            marker = "/" if entry.is_dir() else ""
            lines.append(f"{prefix}{entry.name}{marker}")
            if entry.is_dir():
                walk(entry, depth + 1, prefix + "  ")

    lines.append(f"{path}/")
    walk(path, 1, "  ")
    return "\n".join(lines) if len(lines) > 1 else f"{path}/ (empty)"


def search_files(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    """Find files by glob pattern under a root directory."""
    root = _resolve(args.get("path", "."), cwd, sandbox_root, sandbox_enabled)
    pattern = args["pattern"]
    ignore_dirs = {".git", "__pycache__", "node_modules", "venv", ".venv"}

    matches = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ignore_dirs]
        for fname in filenames:
            if fnmatch.fnmatch(fname, pattern):
                matches.append(str(Path(dirpath) / fname))
                if len(matches) >= MAX_SEARCH_RESULTS:
                    return "\n".join(matches)

    if not matches:
        return f"No files matching '{pattern}' under {root}"
    return "\n".join(matches)


def grep(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    """Search file contents for a substring/regex across a directory tree."""
    import re

    root = _resolve(args.get("path", "."), cwd, sandbox_root, sandbox_enabled)
    query = args["query"]
    is_regex = bool(args.get("regex", False))
    file_glob = args.get("file_pattern", "*")
    ignore_dirs = {".git", "__pycache__", "node_modules", "venv", ".venv"}

    try:
        pattern = re.compile(query) if is_regex else None
    except re.error as e:
        raise ToolError(f"Invalid regex '{query}': {e}") from e

    results = []
    files_scanned = 0

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ignore_dirs]
        for fname in filenames:
            if not fnmatch.fnmatch(fname, file_glob):
                continue
            fpath = Path(dirpath) / fname
            files_scanned += 1
            if files_scanned > MAX_GREP_FILES_SCANNED:
                results.append(f"... [stopped after scanning {MAX_GREP_FILES_SCANNED} files]")
                return _truncate("\n".join(results))
            try:
                text = fpath.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), start=1):
                hit = pattern.search(line) if is_regex else (query in line)
                if hit:
                    results.append(f"{fpath}:{i}: {line.strip()[:200]}")
                    if len(results) >= MAX_GREP_RESULTS:
                        return _truncate("\n".join(results))

    if not results:
        return f"No matches for '{query}' under {root}"
    return _truncate("\n".join(results))


def get_cwd(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    return cwd


def which(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    name = args["name"]
    found = shutil.which(name)
    return found or f"'{name}' not found on PATH"


BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
DUCKDUCKGO_SEARCH_URL = "https://html.duckduckgo.com/html/"
# A real browser UA + headers matter a lot here: DuckDuckGo's HTML endpoint
# soft-blocks (HTTP 202 with an empty/placeholder body, or a "no results"
# looking page) requests that look like naive scripts. This won't work
# 100% of the time under heavy load, but it's the free, no-API-key fallback.
_DUCKDUCKGO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://duckduckgo.com/",
}


def web_search(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    """Search the public web and return a compact, sourceable result list.

    Uses the Brave Search API when BRAVE_API_KEY is configured (a real,
    authenticated endpoint — more reliable and higher quality). Otherwise
    falls back to scraping DuckDuckGo's HTML endpoint, which needs no API
    key but is inherently less reliable: DuckDuckGo actively tries to block
    automated requests, so this path can occasionally fail even though the
    query itself is fine. Either way, failures raise a clear ToolError
    rather than silently returning an empty-looking result. Callers should
    not include secrets or private source code in the query.
    """
    query = str(args["query"]).strip()
    if not query:
        raise ToolError("Search query cannot be empty.")
    try:
        max_results = max(1, min(int(args.get("max_results", 5)), 10))
    except (TypeError, ValueError):
        max_results = 5

    # Imported lazily to avoid a circular import at module load time.
    from . import config as _config

    api_key = _config.get_api_key("brave")
    if api_key:
        return _web_search_brave(query, max_results, api_key)
    return _web_search_duckduckgo(query, max_results)


def _web_search_brave(query: str, max_results: int, api_key: str) -> str:
    url = BRAVE_SEARCH_URL + "?" + urllib.parse.urlencode({"q": query, "count": max_results})
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": api_key,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise ToolError("Web search failed: Brave API key was rejected (401). Check BRAVE_API_KEY.") from error
        if error.code == 429:
            raise ToolError("Web search failed: Brave API rate limit hit (429). Try again shortly.") from error
        raise ToolError(f"Web search failed: HTTP {error.code} from Brave API.") from error
    except Exception as error:  # noqa: BLE001 -- network errors need a concise tool result
        raise ToolError(f"Web search failed: {error}") from error

    entries = (payload.get("web") or {}).get("results") or []
    results: list[str] = []
    for entry in entries[:max_results]:
        title = str(entry.get("title") or "").strip()
        target = str(entry.get("url") or "").strip()
        if title and target:
            results.append(f"- {title}\n  {target}")

    if not results:
        return f"No web results found for: {query}"
    return f"Web results for: {query}\n" + "\n".join(results)


def _web_search_duckduckgo(query: str, max_results: int) -> str:
    url = DUCKDUCKGO_SEARCH_URL + "?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(url, headers=_DUCKDUCKGO_HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            status = getattr(response, "status", 200)
            page = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        if error.code in (202, 403, 429):
            raise ToolError(
                f"Web search failed: DuckDuckGo blocked the request (HTTP {error.code}), likely rate-limiting. "
                "For reliable search, set a free BRAVE_API_KEY (https://brave.com/search/api/) instead."
            ) from error
        raise ToolError(f"Web search failed: HTTP {error.code} from DuckDuckGo.") from error
    except Exception as error:  # noqa: BLE001 -- network errors need a concise tool result
        raise ToolError(f"Web search failed: {error}") from error

    if status == 202 or "html.duckduckgo.com" in page.lower() and "anomaly" in page.lower():
        raise ToolError(
            "Web search failed: DuckDuckGo soft-blocked the request (rate limit / bot check). "
            "For reliable search, set a free BRAVE_API_KEY (https://brave.com/search/api/) instead."
        )

    matches = re.findall(
        r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        page,
        flags=re.IGNORECASE | re.DOTALL,
    )
    results: list[str] = []
    for href, raw_title in matches:
        parsed = urllib.parse.urlparse(html.unescape(href))
        if parsed.netloc.endswith("duckduckgo.com"):
            target = urllib.parse.parse_qs(parsed.query).get("uddg", [href])[0]
        else:
            target = href
        title = re.sub(r"<[^>]+>", "", raw_title)
        title = html.unescape(title).strip()
        if title:
            results.append(f"- {title}\n  {target}")
        if len(results) >= max_results:
            break

    if not results:
        return f"No web results found for: {query}"
    return f"Web results for: {query}\n" + "\n".join(results)


# ---------------------------------------------------------------------------
# Shell / code execution
# ---------------------------------------------------------------------------

def _run_subprocess(argv_or_str: list[str] | str, *, cwd: str, timeout: int, shell: bool,
                     sandbox_enabled: bool) -> tuple[str, str, int | None, bool]:
    """Run a subprocess with a wall-clock timeout, best-effort POSIX resource
    limits, and — critically — kill the *entire process group* on timeout so
    a command that spawns children (a shell pipeline, a dev server, etc.)
    can't outlive the timeout as an orphan.

    Returns (stdout, stderr, returncode_or_None, timed_out).
    """
    is_windows = platform.system() == "Windows"

    if is_windows:
        # No process groups / preexec_fn on Windows; fall back to the plain
        # subprocess.run timeout behavior (kills the direct child only).
        try:
            proc = subprocess.run(
                argv_or_str, shell=shell, cwd=cwd,
                capture_output=True, text=True, timeout=timeout,
            )
            return proc.stdout, proc.stderr, proc.returncode, False
        except subprocess.TimeoutExpired as e:
            return (e.stdout or ""), (e.stderr or ""), None, True

    preexec = sandbox.preexec_limits(cpu_seconds=timeout + 5) if sandbox_enabled else None
    proc = subprocess.Popen(
        argv_or_str, shell=shell, cwd=cwd,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        preexec_fn=preexec, start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout)
        return out, err, proc.returncode, False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            proc.kill()
        try:
            out, err = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            out, err = "", ""
        return out, err, None, True


def _parse_timeout(args: dict) -> int:
    try:
        timeout = int(args.get("timeout", SHELL_TIMEOUT_SECS))
    except (TypeError, ValueError):
        timeout = SHELL_TIMEOUT_SECS
    return max(1, min(timeout, 300))


def run_command(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    command = args["command"]
    timeout = _parse_timeout(args)

    if sandbox_enabled:
        try:
            sandbox.check_command_safety(command)
        except sandbox.SandboxViolation as e:
            raise ToolError(str(e)) from e

    is_windows = platform.system() == "Windows"
    argv = command if is_windows else ["/bin/bash", "-lc", command]

    try:
        out, err, rc, timed_out = _run_subprocess(
            argv, cwd=cwd, timeout=timeout, shell=is_windows, sandbox_enabled=sandbox_enabled,
        )
    except FileNotFoundError as e:
        return f"Failed to execute command: {e}"

    if timed_out:
        parts = [f"$ {command}", f"Command timed out after {timeout}s and was killed (including any child processes)."]
        if out and out.strip():
            parts.append(f"--- stdout (partial) ---\n{_truncate(out)}")
        if err and err.strip():
            parts.append(f"--- stderr (partial) ---\n{_truncate(err)}")
        return "\n".join(parts)

    out = _truncate(out or "")
    err = _truncate(err or "")
    parts = [f"$ {command}", f"(exit code {rc})"]
    if out.strip():
        parts.append(f"--- stdout ---\n{out}")
    if err.strip():
        parts.append(f"--- stderr ---\n{err}")
    return "\n".join(parts)


def run_python(args: dict, cwd: str, *, sandbox_root: str | None = None, sandbox_enabled: bool = True) -> str:
    """Run a short Python snippet with the same subprocess and resource-limit
    protections as run_command, without needing to write a temp file first.
    Useful for quick calculations, data munging, or sanity checks."""
    code = args["code"]
    timeout = _parse_timeout(args)

    try:
        out, err, rc, timed_out = _run_subprocess(
            [sys.executable, "-c", code], cwd=cwd, timeout=timeout, shell=False,
            sandbox_enabled=sandbox_enabled,
        )
    except FileNotFoundError as e:
        return f"Failed to execute python: {e}"

    if timed_out:
        parts = [f"Python snippet timed out after {timeout}s and was killed (including any child processes)."]
        if out and out.strip():
            parts.append(f"--- stdout (partial) ---\n{_truncate(out)}")
        if err and err.strip():
            parts.append(f"--- stderr (partial) ---\n{_truncate(err)}")
        return "\n".join(parts)

    out = _truncate(out or "")
    err = _truncate(err or "")
    parts = [f"(exit code {rc})"]
    if out.strip():
        parts.append(f"--- stdout ---\n{out}")
    if err.strip():
        parts.append(f"--- stderr ---\n{err}")
    if not out.strip() and not err.strip():
        parts.append("(no output)")
    return "\n".join(parts)


def update_missdata(args: dict, cwd: str, *, sandbox_root: str | None = None,
                    sandbox_enabled: bool = True) -> str:
    """Check or apply a trusted fast-forward Miss Data source update.

    The project cwd is deliberately ignored: the update target is the source
    tree that contains the running Miss Data package, and workflows validates
    it against the official repository before any Git action.
    """
    from .workflows import apply_update, missdata_root, update_status

    action = str(args.get("action", "check")).lower()
    if action == "check":
        ok, detail = update_status(missdata_root())
    elif action == "apply":
        ok, detail = apply_update(missdata_root())
        if ok:
            detail += "\nRestart Miss Data. If dependencies changed, run `pip install -r requirements.txt` in its source directory."
    else:
        return "Error: action must be 'check' or 'apply'."
    return detail if ok else "Error: " + detail


# ---------------------------------------------------------------------------
# Tool schema (OpenAI/Groq-style function-calling format; converted for
# Anthropic in providers.py)
# ---------------------------------------------------------------------------

TOOL_SCHEMAS = [
    {
        "name": "read_file",
        "description": "Read a text file's contents, with line numbers. Optionally read only a line range for large files.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path, absolute or relative to the working directory."},
                "start_line": {"type": "integer", "description": "Optional 1-indexed starting line."},
                "end_line": {"type": "integer", "description": "Optional 1-indexed ending line (inclusive)."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Create a new file or completely overwrite an existing file with new content. Creates parent directories as needed. RISKY: overwrites existing content.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to write."},
                "content": {"type": "string", "description": "Full text content to write to the file."},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Make a precise edit to an existing file by replacing an exact, unique snippet of text (old_str) with new text (new_str). old_str must match exactly once in the file. Prefer this over write_file for small changes to existing files.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to edit."},
                "old_str": {"type": "string", "description": "Exact text to find (must be unique in the file). Include enough surrounding context."},
                "new_str": {"type": "string", "description": "Text to replace it with."},
            },
            "required": ["path", "old_str", "new_str"],
        },
    },
    {
        "name": "delete_path",
        "description": "Delete a file or a directory (recursively). RISKY and irreversible — use with care.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File or directory path to delete."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "move_path",
        "description": "Move or rename a file or directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "src": {"type": "string", "description": "Source path."},
                "dst": {"type": "string", "description": "Destination path."},
            },
            "required": ["src", "dst"],
        },
    },
    {
        "name": "make_dir",
        "description": "Create a directory (and parent directories) if it doesn't already exist.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path to create."},
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_dir",
        "description": "List files and subdirectories in a tree view, similar to `ls`/`tree`. Automatically skips common noise directories like .git, node_modules, venv.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory to list. Defaults to the current working directory."},
                "max_depth": {"type": "integer", "description": "How many levels deep to recurse. Default 2."},
            },
            "required": [],
        },
    },
    {
        "name": "search_files",
        "description": "Find files by filename glob pattern (e.g. '*.py', 'test_*.js') under a directory tree.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Glob pattern to match against filenames, e.g. '*.py'."},
                "path": {"type": "string", "description": "Root directory to search under. Defaults to cwd."},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "grep",
        "description": "Search file contents for a text string or regex pattern across a directory tree, returning matching file:line: content.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Text or regex pattern to search for."},
                "path": {"type": "string", "description": "Root directory to search under. Defaults to cwd."},
                "regex": {"type": "boolean", "description": "Treat query as a regex. Default false (plain substring)."},
                "file_pattern": {"type": "string", "description": "Glob to filter which filenames are scanned, e.g. '*.py'. Default '*'."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "run_command",
        "description": "Execute a shell command (bash on Linux/macOS, cmd on Windows) in the working directory and return stdout/stderr/exit code. RISKY — can install packages, run tests, build, run scripts, git commands, etc. When sandboxing is on, obviously destructive commands are blocked and the process (and any children) is killed if it exceeds the timeout.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The shell command to run."},
                "timeout": {"type": "integer", "description": "Max seconds to wait. Default 60, max 300."},
            },
            "required": ["command"],
        },
    },
    {
        "name": "run_python",
        "description": "Run a short Python snippet in a fresh interpreter (equivalent to `python -c <code>`) and return stdout/stderr/exit code. Handy for quick calculations, data checks, or exercising a function without writing a throwaway script file. RISKY — arbitrary code execution, same protections as run_command.",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python source to execute."},
                "timeout": {"type": "integer", "description": "Max seconds to wait. Default 60, max 300."},
            },
            "required": ["code"],
        },
    },
    {
        "name": "get_cwd",
        "description": "Return the agent's current working directory.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "which",
        "description": "Check whether a command/executable exists on PATH and return its location.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Executable name, e.g. 'node' or 'git'."},
            },
            "required": ["name"],
        },
    },
    {
        "name": "update_missdata",
        "description": "Check or apply a self-update for Miss Data from its trusted official Git source. Apply is RISKY: it fast-forwards only when the source tree is clean and must be approved. Never use arbitrary URLs or repositories.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["check", "apply"], "description": "Use check to preview status or apply to fast-forward the trusted source."},
            },
            "required": ["action"],
        },
    },
    {
        "name": "web_search",
        "description": "Search the public web for current information and return result titles and URLs. Uses the Brave Search API if BRAVE_API_KEY is set, otherwise falls back to DuckDuckGo; never search for secrets or private source code.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Public web search query."},
                "max_results": {"type": "integer", "description": "Number of results to return (1-10, default 5)."},
            },
            "required": ["query"],
        },
    },
]

TOOL_IMPLEMENTATIONS = {
    "read_file": read_file,
    "write_file": write_file,
    "edit_file": edit_file,
    "delete_path": delete_path,
    "move_path": move_path,
    "make_dir": make_dir,
    "list_dir": list_dir,
    "search_files": search_files,
    "grep": grep,
    "run_command": run_command,
    "run_python": run_python,
    "get_cwd": get_cwd,
    "which": which,
    "web_search": web_search,
    "update_missdata": update_missdata,
}


def describe_call(name: str, args: dict) -> str:
    """Human-readable one-liner for what a tool call is about to do (shown for approval)."""
    if name == "read_file":
        return f"Read {args.get('path')}"
    if name == "write_file":
        content = args.get("content", "")
        return f"Write {args.get('path')} ({len(content)} chars)"
    if name == "edit_file":
        return f"Edit {args.get('path')}"
    if name == "delete_path":
        return f"DELETE {args.get('path')}"
    if name == "move_path":
        return f"Move {args.get('src')} -> {args.get('dst')}"
    if name == "make_dir":
        return f"Create directory {args.get('path')}"
    if name == "list_dir":
        return f"List {args.get('path', '.')}"
    if name == "search_files":
        return f"Search for files matching {args.get('pattern')} in {args.get('path', '.')}"
    if name == "grep":
        return f"Search file contents for '{args.get('query')}' in {args.get('path', '.')}"
    if name == "run_command":
        return f"Run: {args.get('command')}"
    if name == "update_missdata":
        return f"Self-update Miss Data ({args.get('action', 'check')})"
    if name == "run_python":
        code = args.get("code", "")
        preview = code if len(code) <= 60 else code[:57] + "..."
        return f"Run python: {preview}"
    if name == "get_cwd":
        return "Get working directory"
    if name == "which":
        return f"Check for '{args.get('name')}' on PATH"
    if name == "web_search":
        return f"Search the web for '{args.get('query')}'"
    return f"{name}({args})"
