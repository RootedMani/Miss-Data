"""
Configuration for Miss Data.

Handles:
- Loading API keys from .env / environment
- Persistent user settings (provider, model, approval mode, workdir) stored
  in a small JSON file in the user's config directory
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

from dotenv import load_dotenv

APP_NAME = "missdata"


def _config_dir() -> Path:
    """Cross-platform per-user config directory."""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_NAME
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    # Linux / other unix
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else Path.home() / ".config"
    return base / APP_NAME


CONFIG_DIR = _config_dir()
SETTINGS_PATH = CONFIG_DIR / "settings.json"
MEMORY_PATH = CONFIG_DIR / "memory.json"
HISTORY_PATH = CONFIG_DIR / "history"

DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
DEFAULT_OLLAMA_MODEL = "llama3.2"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"

APPROVAL_MODES = ("always", "risky", "auto")
PROVIDERS = ("groq", "anthropic", "ollama")


@dataclass
class Settings:
    provider: str = "groq"
    groq_model: str = DEFAULT_GROQ_MODEL
    anthropic_model: str = DEFAULT_ANTHROPIC_MODEL
    ollama_model: str = DEFAULT_OLLAMA_MODEL
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    ollama_num_gpu: int | None = None   # force N layers on GPU; None = let Ollama auto-decide
    ollama_num_ctx: int | None = None   # override context window; None = model/server default
    approval_mode: str = "risky"   # always | risky | auto
    sandbox_mode: bool = True      # confine file tools to cwd + block dangerous commands
    language: str = "en"           # en | fa  (affects a few UI strings)
    max_output_tokens: int = 4096

    @classmethod
    def load(cls) -> "Settings":
        if SETTINGS_PATH.exists():
            try:
                data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
                known = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
                return cls(**known)
            except (json.JSONDecodeError, TypeError):
                pass
        return cls()

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    @property
    def model(self) -> str:
        if self.provider == "groq":
            return self.groq_model
        if self.provider == "ollama":
            return self.ollama_model
        return self.anthropic_model

    @model.setter
    def model(self, value: str) -> None:
        if self.provider == "groq":
            self.groq_model = value
        elif self.provider == "ollama":
            self.ollama_model = value
        else:
            self.anthropic_model = value


def ensure_dirs() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_env() -> None:
    """Load .env from cwd and from the config dir (config dir takes precedence for keys)."""
    load_dotenv()  # project-local .env, if any
    env_in_config = CONFIG_DIR / ".env"
    if env_in_config.exists():
        load_dotenv(dotenv_path=env_in_config, override=True)


def get_api_key(provider: str) -> str | None:
    if provider == "groq":
        return os.environ.get("GROQ_API_KEY")
    if provider == "anthropic":
        return os.environ.get("ANTHROPIC_API_KEY")
    if provider == "ollama":
        # Local server — no API key required. Returned as a truthy sentinel
        # so the shared "do we have credentials?" checks in cli.py pass.
        return "not-required"
    return None


def save_api_key(provider: str, key: str) -> None:
    """Persist an API key into the config dir's .env file."""
    ensure_dirs()
    env_path = CONFIG_DIR / ".env"
    var_name = "GROQ_API_KEY" if provider == "groq" else "ANTHROPIC_API_KEY"

    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    found = False
    for i, line in enumerate(lines):
        if line.startswith(f"{var_name}="):
            lines[i] = f"{var_name}={key}"
            found = True
            break
    if not found:
        lines.append(f"{var_name}={key}")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[var_name] = key
