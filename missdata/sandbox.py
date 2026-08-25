"""
Sandbox for Miss Data's filesystem and shell tools.

Two independent protections, on by default whenever `settings.sandbox_mode`
is True:

1. **Path confinement** — file tools (read/write/edit/delete/move/mkdir/
   list_dir/search_files/grep) are restricted to the agent's working
   directory (the "sandbox root"). Symlinks and `..` tricks are resolved
   *before* the containment check, so they can't be used to escape it.

2. **Command guarding** for `run_command` / `run_python` — a deny-list of
   unambiguously destructive shell patterns (wiping a disk, `rm -rf /`,
   fork bombs, `curl | sh`, `sudo`, ...), plus best-effort POSIX resource
   limits (CPU time, memory, process count) applied to the child process
   so a runaway or malicious command can't take down the host.

This is defense-in-depth for a *local* single-user agent, not a hardened
multi-tenant jail — `run_command` still has real shell access within the
sandbox root and the resource limits. Turning `sandbox_mode` off restores
the old "local dev tool, full trust" behavior; do that only in a throwaway
environment or a project you already trust completely.
"""

from __future__ import annotations

import os
import platform
import re
from pathlib import Path


class SandboxViolation(Exception):
    """Raised when a tool call would breach the sandbox (path escape or a
    denylisted command). Callers should surface this to the model as a
    normal tool error, not crash the agent."""


# ---------------------------------------------------------------------------
# Path confinement
# ---------------------------------------------------------------------------

def resolve_in_sandbox(path: str, cwd: str, sandbox_root: str) -> Path:
    """Resolve `path` (absolute or relative to `cwd`) and ensure the result
    stays inside `sandbox_root`. Raises SandboxViolation otherwise.

    Resolution happens via Path.resolve(), which normalizes '..' segments
    and follows symlinks, so both "../../etc/passwd" and a symlink planted
    inside the project that points outside it are caught.
    """
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = Path(cwd) / p
    resolved = p.resolve()

    root = Path(sandbox_root).resolve()
    if resolved != root and root not in resolved.parents:
        raise SandboxViolation(
            f"'{path}' resolves to {resolved}, which is outside the sandboxed "
            f"working directory ({root}). This agent is confined to that "
            f"directory. If you genuinely need to touch files elsewhere, ask "
            f"the user to run with sandbox disabled (`/sandbox off` or "
            f"`--sandbox off`)."
        )
    return resolved


# ---------------------------------------------------------------------------
# Command guarding
# ---------------------------------------------------------------------------

# Deliberately conservative: only patterns that are essentially never what
# you want from an autonomous agent running unattended. This is a safety
# net, not a substitute for approval prompts.
_DANGEROUS_COMMAND_PATTERNS = [
    r"\brm\s+[^\n|;&]*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+/(\s|$)",   # rm -rf /
    r"\brm\s+[^\n|;&]*-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+/(\s|$)",   # rm -fr /
    r"\brm\s+[^\n|;&]*-[a-zA-Z]*r[a-zA-Z]*[^\n|;&]*\s+/\*",         # rm -r /*
    r"\bmkfs(\.\w+)?\b",                                            # format a filesystem
    r"\bdd\b[^\n]*\bof=/dev/",                                      # dd straight onto a device
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&?\s*\}\s*;\s*:",                   # classic fork bomb
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bsudo\b",
    r"\bchmod\s+-R\s+777\s+/(\s|$)",
    r"\bchown\s+-R\b[^\n]*\s/(\s|$)",
    r">\s*/dev/sd[a-z]\b",
    r"\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b",        # download | shell
    r"\b(iptables|ufw)\b[^\n]*\bflush\b",
]

_DANGEROUS_RE = re.compile("|".join(_DANGEROUS_COMMAND_PATTERNS), re.IGNORECASE)


def check_command_safety(command: str) -> None:
    """Raise SandboxViolation if `command` matches an unambiguously
    destructive pattern. A deny-list, not a guarantee — it catches the
    classic footguns, not every way to cause damage."""
    match = _DANGEROUS_RE.search(command)
    if match:
        raise SandboxViolation(
            "Refusing to run this command: it matches a pattern that is "
            "almost always destructive or irreversible (wiping a disk, "
            "recursively deleting '/', shutting the machine down, piping a "
            "download straight into a shell, or invoking sudo). If this is "
            "genuinely intended, the user can run it themselves outside the "
            "agent, or disable the sandbox with /sandbox off."
        )


def preexec_limits(cpu_seconds: int = 60, mem_bytes: int = 2 * 1024 * 1024 * 1024, max_procs: int = 128):
    """Build a `preexec_fn` for subprocess.Popen that applies best-effort
    POSIX resource limits to the child (and puts it in its own session so
    the whole process group can be killed on timeout). Returns None on
    Windows, where none of this is available."""
    if platform.system() == "Windows":
        return None

    def _limit() -> None:
        import resource  # POSIX-only

        try:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        except (ValueError, OSError):
            pass
        try:
            resource.setrlimit(resource.RLIMIT_NPROC, (max_procs, max_procs))
        except (ValueError, OSError):
            pass
        try:
            os.setsid()  # new session -> can kill the whole group on timeout
        except OSError:
            pass

    return _limit
