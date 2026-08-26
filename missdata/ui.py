"""
Terminal UI helpers for Miss Data: colors, banner, approval prompts.
Uses colorama so ANSI colors work correctly on Windows cmd/PowerShell too.
"""

from __future__ import annotations

import shutil
import sys

from colorama import Fore, Style, init as colorama_init

colorama_init(autoreset=True)

RESET = Style.RESET_ALL


def _c(text: str, color: str, bold: bool = False) -> str:
    prefix = (Style.BRIGHT if bold else "") + color
    return f"{prefix}{text}{RESET}"


def cyan(t): return _c(t, Fore.CYAN)
def magenta(t): return _c(t, Fore.MAGENTA, bold=True)
def green(t): return _c(t, Fore.GREEN)
def yellow(t): return _c(t, Fore.YELLOW)
def red(t): return _c(t, Fore.RED, bold=True)
def dim(t): return _c(t, Fore.WHITE)
def bold(t): return _c(t, Fore.WHITE, bold=True)


BANNER = r"""
   __  ____              ____        __
  /  |/  (_)__ ___       / __ \___ _/ /_____ _
 / /|_/ / (_-<(_-<      / / / / _ `/ __/ _ `/
/_/  /_/_/___/___/     /_____/\_,_/\__/\_,_/
"""


def print_banner(provider: str, model: str, cwd: str, sandbox_mode: bool = True) -> None:
    width = shutil.get_terminal_size(fallback=(80, 24)).columns
    print(magenta(BANNER))
    print(cyan("  Miss Data") + dim("  •  ") + "خانم داده" + dim("  —  terminal coding agent"))
    print(dim("  " + "─" * min(60, width - 2)))
    print(f"  {dim('provider:')} {bold(provider)}   {dim('model:')} {bold(model)}")
    print(f"  {dim('cwd:')} {cwd}")
    if sandbox_mode:
        print(f"  {dim('sandbox:')} {green('on')} {dim('(file tools confined to cwd, dangerous commands blocked)')}")
    else:
        print(f"  {dim('sandbox:')} {red('OFF')} {dim('— full filesystem and shell access, no confinement')}")
    print(dim("  Type your request, or /help for commands. /exit to quit."))
    print()


def print_files_summary(paths: list[str]) -> None:
    """Show which files the agent created/edited/deleted/moved this turn, so
    the user gets a clear 'here's what I produced' summary without having to
    scroll back through every tool call."""
    if not paths:
        return
    print(bold("\nFiles touched this turn:"))
    for p in paths:
        print(green("  ✓ ") + p)
    print()


def print_help() -> None:
    rows = [
        ("/help", "Show this help"),
        ("/exit, /quit", "Exit Miss Data"),
        ("/clear", "Clear the current conversation (keeps memory facts)"),
        ("/compact [n]", "Summarize older turns into one note to shrink context (keep n recent turns verbatim)"),
        ("/memory", "Show remembered facts"),
        ("/forget <n>", "Remove remembered fact number n"),
        ("/cwd <path>", "Change the agent's working directory"),
        ("/provider <name>", "Switch LLM provider (groq|anthropic|ollama|deepseek|openai|...|custom)"),
        ("/keys", "Show configured key-pool counts without exposing keys"),
        ("/keys add <provider>", "Append one or more API keys for automatic same-provider retry"),
        ("/fallback", "Show the provider order offered after the active provider fails"),
        ("/fallback set <names>", "Set offer order, e.g. groq,openai,anthropic; every switch still asks"),
        ("/fallback off", "Disable cross-provider fallback while keeping key rotation"),
        ("/context-recovery <ask|auto|off>", "Compact/retry after context-limit errors, automatically or with permission"),
        ("/ollama-recovery <ask|auto|off>", "Start local Ollama or pull a missing model after failure, with permission"),
        ("/logs", "Show the path to the current structured activity log"),
        ("/model <name>", "Set the model for the current provider"),
        ("/ollama-url <url>", "Set the Ollama server URL (default http://localhost:11434)"),
        ("/gpu-layers <n>|auto", "Force N layers onto GPU for Ollama (troubleshoots low-VRAM cards)"),
        ("/base-url <url>", "Set the API base URL for the 'custom' provider"),
        ("/api-key-env <VAR>", "Set which env var the 'custom' provider reads its API key from"),
        ("/approval <always|risky|auto>", "Set how risky actions are confirmed"),
        ("/sandbox <on|off>", "Confine file tools to cwd + block dangerous commands (default: on)"),
        ("/lang <en|fa>", "Set the assistant response language"),
    ]
    print(bold("\nCommands:"))
    for cmd, desc in rows:
        print(f"  {cyan(cmd):<34} {dim(desc)}")
    print()


def print_user_prompt_marker() -> str:
    return bold("You") + dim(" › ")


def print_agent_marker() -> None:
    print(magenta("Miss Data") + dim(" ›") + " ", end="", flush=True)


class ThinkingSpinner:
    """Shows a spinner after the agent marker until the first output token
    arrives, so a slow/local model reads as 'working' rather than 'hung'.
    Call .stop() the moment any real output is about to be printed."""

    _FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    def __init__(self):
        self._stop_event = None
        self._thread = None

    def start(self) -> None:
        import threading
        import time

        self._stop_event = threading.Event()

        def _spin():
            i = 0
            while not self._stop_event.is_set():
                frame = self._FRAMES[i % len(self._FRAMES)]
                print(dim(frame), end="", flush=True)
                time.sleep(0.08)
                print("\b", end="", flush=True)  # erase the frame, cursor stays put
                i += 1

        self._thread = threading.Thread(target=_spin, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._stop_event is None:
            return
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=0.5)
        print(" \b", end="", flush=True)  # clean up any leftover spinner glyph
        self._stop_event = None
        self._thread = None


def print_tool_call(description: str, risky: bool) -> None:
    tag = red("[action]") if risky else dim("[tool]")
    print(f"\n{tag} {description}")


def print_tool_result(result: str, max_lines: int = 12) -> None:
    lines = result.splitlines()
    shown = lines[:max_lines]
    for line in shown:
        print(dim("  │ ") + line)
    if len(lines) > max_lines:
        print(dim(f"  │ ... ({len(lines) - max_lines} more lines)"))
    print()


def print_error(msg: str) -> None:
    print(red("Error: ") + msg)


def print_info(msg: str) -> None:
    print(dim(msg))


def ask_approval(description: str) -> bool:
    """Ask the user to approve a risky action. Returns True if approved."""
    print(yellow(f"\n⚠ Approval needed: ") + description)
    try:
        answer = input(dim("  Proceed? [y/N/a=always for this session]: ")).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer in ("y", "yes", "a", "always")


def is_always(description_answer: str) -> bool:
    return description_answer in ("a", "always")
