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
from dataclasses import dataclass, asdict, field
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

# OpenAI-compatible chat-completions services (DeepSeek and other popular
# API providers that speak the same /chat/completions + SSE-streaming
# protocol as OpenAI). One shared provider implementation (see
# OpenAICompatibleProvider in providers.py) drives all of these — adding a
# new one is just adding an entry here, no new client code required.
#
# NOTE: `default_model` is a reasonable starting point, not a guarantee —
# providers rename/retire models over time. Override anytime with
# `/model <name>` or `--model <name>` if the default 404s.
OPENAI_COMPATIBLE_PRESETS: dict[str, dict[str, str]] = {
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "env_var": "DEEPSEEK_API_KEY",
        "default_model": "deepseek-chat",
        "signup_url": "https://platform.deepseek.com/api_keys",
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "env_var": "OPENAI_API_KEY",
        "default_model": "gpt-4o-mini",
        "signup_url": "https://platform.openai.com/api-keys",
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "env_var": "OPENROUTER_API_KEY",
        "default_model": "openai/gpt-4o-mini",
        "signup_url": "https://openrouter.ai/keys",
    },
    "together": {
        "label": "Together AI",
        "base_url": "https://api.together.xyz/v1",
        "env_var": "TOGETHER_API_KEY",
        "default_model": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "signup_url": "https://api.together.ai/settings/api-keys",
    },
    "mistral": {
        "label": "Mistral",
        "base_url": "https://api.mistral.ai/v1",
        "env_var": "MISTRAL_API_KEY",
        "default_model": "mistral-large-latest",
        "signup_url": "https://console.mistral.ai/api-keys",
    },
    "fireworks": {
        "label": "Fireworks AI",
        "base_url": "https://api.fireworks.ai/inference/v1",
        "env_var": "FIREWORKS_API_KEY",
        "default_model": "accounts/fireworks/models/llama-v3p3-70b-instruct",
        "signup_url": "https://fireworks.ai/api-keys",
    },
    "xai": {
        "label": "xAI (Grok)",
        "base_url": "https://api.x.ai/v1",
        "env_var": "XAI_API_KEY",
        "default_model": "grok-beta",
        "signup_url": "https://console.x.ai",
    },
    "moonshot": {
        "label": "Moonshot AI (Kimi)",
        "base_url": "https://api.moonshot.cn/v1",
        "env_var": "MOONSHOT_API_KEY",
        "default_model": "moonshot-v1-8k",
        "signup_url": "https://platform.moonshot.cn/console/api-keys",
    },
    "perplexity": {
        "label": "Perplexity",
        "base_url": "https://api.perplexity.ai",
        "env_var": "PERPLEXITY_API_KEY",
        "default_model": "sonar",
        "signup_url": "https://www.perplexity.ai/settings/api",
    },
}

APPROVAL_MODES = ("always", "risky", "auto")
PROVIDERS = ("groq", "anthropic", "ollama", *OPENAI_COMPATIBLE_PRESETS.keys(), "custom")


@dataclass
class Settings:
    provider: str = "groq"
    groq_model: str = DEFAULT_GROQ_MODEL
    anthropic_model: str = DEFAULT_ANTHROPIC_MODEL
    ollama_model: str = DEFAULT_OLLAMA_MODEL
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    ollama_num_gpu: int | None = None   # force N layers on GPU; None = let Ollama auto-decide
    ollama_num_ctx: int | None = None   # override context window; None = model/server default
    # Model chosen per OpenAI-compatible preset (deepseek, openrouter, ...),
    # keyed by provider name, so switching providers remembers your pick.
    openai_compatible_models: dict[str, str] = field(default_factory=dict)
    # Only used when provider == "custom": point at any OpenAI-compatible
    # /chat/completions endpoint not covered by a built-in preset.
    custom_base_url: str = ""
    custom_model: str = ""
    custom_api_key_env: str = "CUSTOM_API_KEY"
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
        if self.provider == "anthropic":
            return self.anthropic_model
        if self.provider == "custom":
            return self.custom_model
        if self.provider in OPENAI_COMPATIBLE_PRESETS:
            return self.openai_compatible_models.get(self.provider) or OPENAI_COMPATIBLE_PRESETS[self.provider]["default_model"]
        return self.anthropic_model

    @model.setter
    def model(self, value: str) -> None:
        if self.provider == "groq":
            self.groq_model = value
        elif self.provider == "ollama":
            self.ollama_model = value
        elif self.provider == "anthropic":
            self.anthropic_model = value
        elif self.provider == "custom":
            self.custom_model = value
        elif self.provider in OPENAI_COMPATIBLE_PRESETS:
            self.openai_compatible_models[self.provider] = value
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
    if provider == "brave":
        # Not a model provider — used by the web_search tool (tools.py).
        return os.environ.get("BRAVE_API_KEY")
    if provider == "ollama":
        # Local server — no API key required. Returned as a truthy sentinel
        # so the shared "do we have credentials?" checks in cli.py pass.
        return "not-required"
    if provider in OPENAI_COMPATIBLE_PRESETS:
        return os.environ.get(OPENAI_COMPATIBLE_PRESETS[provider]["env_var"])
    if provider == "custom":
        # The env var name itself is user-configurable (settings.custom_api_key_env)
        # since a fully custom endpoint has no fixed convention.
        settings = Settings.load()
        return os.environ.get(settings.custom_api_key_env or "CUSTOM_API_KEY")
    return None


def save_api_key(provider: str, key: str) -> None:
    """Persist an API key into the config dir's .env file."""
    ensure_dirs()
    env_path = CONFIG_DIR / ".env"
    if provider in OPENAI_COMPATIBLE_PRESETS:
        var_name = OPENAI_COMPATIBLE_PRESETS[provider]["env_var"]
    elif provider == "custom":
        var_name = Settings.load().custom_api_key_env or "CUSTOM_API_KEY"
    else:
        var_name = {"groq": "GROQ_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "brave": "BRAVE_API_KEY"}.get(
            provider, "ANTHROPIC_API_KEY"
        )

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
