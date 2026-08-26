"""Interactive terminal input with editing and history, plus a plain-input fallback."""
from __future__ import annotations

import atexit
from pathlib import Path
from typing import Callable


class TerminalInput:
    """Provide readline-like editing even when a shell does not supply it.

    `prompt_toolkit` gives Linux terminals normal left/right movement, deletion,
    multiline navigation, and history inside the program. If it is unavailable
    or stdin is not a TTY, the supplied standard input function is used instead.
    """

    def __init__(self, history_path: Path, fallback_input: Callable[[str], str] = input):
        self.history_path = history_path
        self.fallback_input = fallback_input
        self._session = None
        self._ready = False

    def setup(self) -> bool:
        try:
            import sys
            if not sys.stdin.isatty() or not sys.stdout.isatty():
                return False
            from prompt_toolkit import PromptSession
            from prompt_toolkit.history import FileHistory
            from prompt_toolkit.key_binding import KeyBindings
        except (ImportError, OSError):
            return False

        try:
            self.history_path.parent.mkdir(parents=True, exist_ok=True)
            bindings = KeyBindings()

            @bindings.add("c-c")
            def _(event):
                # At an input prompt, Ctrl+C abandons the unfinished line but
                # keeps the REPL alive. During generation Agent handles it.
                event.app.current_buffer.reset()
                event.app.exit(result="")

            self._session = PromptSession(
                history=FileHistory(str(self.history_path)),
                multiline=False,
                key_bindings=bindings,
                enable_history_search=True,
            )
            self._ready = True
            atexit.register(self.close)
            return True
        except Exception:  # noqa: BLE001 -- input must remain usable on unusual terminals
            self._session = None
            self._ready = False
            return False

    def prompt(self, label: str) -> str:
        if self._ready and self._session is not None:
            try:
                # Colorama emits ANSI control sequences. Prompt Toolkit treats
                # a plain string as literal text, so wrap it in ANSI to parse
                # the styling and prevent visible "^[" escape-code artifacts.
                from prompt_toolkit.formatted_text import ANSI
                return self._session.prompt(ANSI(label))
            except EOFError:
                raise
            except KeyboardInterrupt:
                # Ctrl+C at the input prompt abandons only the unfinished line.
                # Ctrl+C during a provider stream is handled by Agent instead.
                return ""
        return self.fallback_input(label)

    def close(self) -> None:
        # FileHistory writes as commands are accepted; this hook is retained as
        # a no-op cleanup point and prevents future implementations leaking it.
        self._session = None
