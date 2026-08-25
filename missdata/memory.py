"""
Simple persistent memory: durable facts Miss Data remembers across sessions.
Stored as JSON in the user config directory (not per-project).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from .config import MEMORY_PATH, ensure_dirs


def load_memory() -> dict:
    if not MEMORY_PATH.exists():
        return {"facts": []}
    try:
        return json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"facts": []}


def save_memory(memory: dict) -> None:
    ensure_dirs()
    MEMORY_PATH.write_text(json.dumps(memory, indent=2, ensure_ascii=False), encoding="utf-8")


def add_fact(fact: str) -> None:
    fact = fact.strip()
    if not fact:
        return
    memory = load_memory()
    existing = {f["text"] if isinstance(f, dict) else f for f in memory["facts"]}
    if fact not in existing:
        memory["facts"].append({
            "text": fact,
            "added": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
        save_memory(memory)


def remove_fact(index: int) -> bool:
    memory = load_memory()
    if 0 <= index < len(memory["facts"]):
        memory["facts"].pop(index)
        save_memory(memory)
        return True
    return False


def clear_facts() -> None:
    save_memory({"facts": []})


def facts_as_text() -> str:
    memory = load_memory()
    facts = memory.get("facts", [])
    if not facts:
        return "No facts stored yet."
    lines = []
    for f in facts:
        text = f["text"] if isinstance(f, dict) else f
        lines.append(f"- {text}")
    return "\n".join(lines)
