"""Local conversation persistence with explicit listing, resume, rename, and deletion."""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import CONFIG_DIR

SESSIONS_DIR = CONFIG_DIR / "sessions"
_SAFE_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path(session_id: str) -> Path:
    if not _SAFE_ID_RE.fullmatch(session_id):
        raise ValueError("Invalid session ID.")
    return SESSIONS_DIR / f"{session_id}.json"


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]


def _write(path: Path, data: dict[str, Any]) -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def save(session_id: str, *, title: str, cwd: str, provider: str, model: str,
         messages: list[dict], activity_log: str) -> None:
    path = _path(session_id)
    existing = load(session_id) if path.exists() else {}
    data = {
        "id": session_id,
        "title": title or existing.get("title") or "Untitled session",
        "created_at": existing.get("created_at") or _now(),
        "updated_at": _now(),
        "cwd": cwd,
        "provider": provider,
        "model": model,
        "activity_log": activity_log,
        "messages": messages,
    }
    _write(path, data)


def load(session_id: str) -> dict[str, Any]:
    path = _path(session_id)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("id") != session_id or not isinstance(data.get("messages", []), list):
        raise ValueError("Session file is invalid.")
    return data


def list_sessions(limit: int = 30) -> list[dict[str, Any]]:
    if not SESSIONS_DIR.exists():
        return []
    rows: list[dict[str, Any]] = []
    for path in SESSIONS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and _SAFE_ID_RE.fullmatch(str(data.get("id", ""))):
                rows.append({
                    "id": data["id"], "title": str(data.get("title", "Untitled session")),
                    "updated_at": str(data.get("updated_at", "")), "provider": str(data.get("provider", "")),
                    "model": str(data.get("model", "")), "message_count": len(data.get("messages", [])),
                })
        except (OSError, json.JSONDecodeError):
            continue
    return sorted(rows, key=lambda row: row["updated_at"], reverse=True)[:limit]


def rename(session_id: str, title: str) -> None:
    data = load(session_id)
    data["title"] = title.strip() or "Untitled session"
    data["updated_at"] = _now()
    _write(_path(session_id), data)


def delete(session_id: str) -> bool:
    path = _path(session_id)
    if not path.exists():
        return False
    path.unlink()
    return True


def delete_all() -> int:
    count = 0
    if SESSIONS_DIR.exists():
        for path in SESSIONS_DIR.glob("*.json"):
            try:
                path.unlink()
                count += 1
            except OSError:
                pass
    return count
