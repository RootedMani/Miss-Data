"""Structured, local activity logging for Miss Data.

The logger is deliberately best-effort: a full disk or permission issue must not
prevent the agent from answering.  It writes newline-delimited JSON so a log can
be inspected with any editor or processed with standard command-line tools.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import LOG_DIR


_SECRET_NAME_RE = re.compile(r"(?:api[_-]?key|token|secret|password|authorization|cookie)", re.IGNORECASE)
_SECRET_VALUE_RE = re.compile(r"\b(?:sk|gsk|rk|AIza)[-_A-Za-z0-9]{12,}\b")


def log_directory() -> Path:
    """Return the directory used for user-readable local activity logs."""
    return LOG_DIR


class ActivityLogger:
    """Append redacted events to a per-session JSONL file.

    Content is retained so the log can serve as an execution record, but keys,
    tokens, passwords, and authorization headers are redacted before anything
    reaches disk.  Writes never raise to the caller.
    """

    def __init__(self, session_id: str | None = None, directory: Path | None = None):
        self.session_id = session_id or uuid.uuid4().hex[:12]
        self.directory = directory or log_directory()
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.path = self.directory / f"missdata-{timestamp}-{self.session_id}.jsonl"
        self._secret_values = self._collect_secret_values()
        self._ensure_file()
        self.event("session_started", process_id=os.getpid())

    @staticmethod
    def _collect_secret_values() -> list[str]:
        values: list[str] = []
        for name, value in os.environ.items():
            if _SECRET_NAME_RE.search(name) and value and value != "not-required" and len(value) >= 4:
                values.append(value)
        return sorted(set(values), key=len, reverse=True)

    def _ensure_file(self) -> None:
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            self.path.touch(exist_ok=True)
            try:
                self.path.chmod(0o600)
            except OSError:
                # Windows and some networked file systems do not support POSIX modes.
                pass
        except OSError:
            # event() will simply become a no-op if storage cannot be prepared.
            pass

    @staticmethod
    def key_fingerprint(api_key: str | None) -> str | None:
        """Provide a stable, non-reversible identifier for a configured key."""
        if not api_key or api_key == "not-required":
            return None
        return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:12]

    def _redact_text(self, value: str) -> str:
        redacted = value
        for secret in self._secret_values:
            redacted = redacted.replace(secret, "[REDACTED]")
        return _SECRET_VALUE_RE.sub("[REDACTED]", redacted)

    def _redact(self, value: Any, field_name: str = "") -> Any:
        # A fingerprint is deliberately one-way and only identifies which
        # configured slot was used; retain it for useful failover diagnostics.
        if _SECRET_NAME_RE.search(field_name) and not field_name.endswith("_fingerprint"):
            return "[REDACTED]"
        if isinstance(value, str):
            return self._redact_text(value)
        if isinstance(value, dict):
            return {str(key): self._redact(item, str(key)) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [self._redact(item, field_name) for item in value]
        return value

    def event(self, event_name: str, **details: Any) -> None:
        """Record one event; never allow a logging failure to interrupt work."""
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": self.session_id,
            "event": event_name,
            **self._redact(details),
        }
        try:
            self._ensure_file()
            with self.path.open("a", encoding="utf-8") as log_file:
                log_file.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        except OSError:
            pass

    def close(self) -> None:
        self.event("session_finished")
