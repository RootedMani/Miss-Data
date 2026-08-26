"""
Provider abstraction layer.

Both Groq and Anthropic are exposed through the same interface:

    provider.stream_turn(messages, tool_schemas) -> StreamResult

Internally each provider keeps its own message format. We standardize on a
simple internal message shape:

    {"role": "user"|"assistant"|"tool_result", "content": str, ...}

and each provider's `to_native_messages` converts to what the SDK wants.
To keep this manageable, agent.py actually owns the canonical conversation
state in each provider's *native* format directly (simplest and most robust
for tool-calling round-trips), and this module just wraps the raw client
calls + streaming + tool-call accumulation into one normalized result.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .config import OPENAI_COMPATIBLE_PRESETS, Settings, get_api_key
from . import ui


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # raw JSON string


@dataclass
class StreamResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str | None = None


class ProviderError(Exception):
    pass


def normalize_proxy_environment() -> None:
    """Make common SOCKS proxy URLs compatible with httpx-based SDKs.

    Several desktop proxy clients export ``socks://`` in ``ALL_PROXY``. httpx
    accepts the explicit ``socks5://`` scheme instead, so normalize only that
    spelling before either remote-provider client is constructed. SOCKS support
    itself is supplied by the ``httpx[socks]`` dependency.
    """
    for name in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
        value = os.environ.get(name)
        if value and value.lower().startswith("socks://"):
            os.environ[name] = "socks5://" + value[len("socks://"):]


def provider_startup_error(provider: str, error: Exception) -> ProviderError:
    """Explain proxy setup failures without exposing credentials in URLs."""
    message = str(error)
    if "proxy" in message.lower() or "socks" in message.lower():
        return ProviderError(
            f"Failed to configure {provider} network access: {message}. "
            "If you use a SOCKS proxy, reinstall dependencies with "
            "`pip install -r requirements.txt` so `httpx[socks]` installs its "
            "SOCKS support; otherwise unset ALL_PROXY/HTTP_PROXY/HTTPS_PROXY."
        )
    return ProviderError(f"Failed to initialize {provider} client: {message}")


# ---------------------------------------------------------------------------
# Groq (OpenAI-compatible chat.completions API)
# ---------------------------------------------------------------------------

class GroqProvider:
    name = "groq"

    def __init__(self, settings: Settings, on_text: Callable[[str], None] | None = None,
                 api_key: str | None = None):
        from groq import Groq  # local import: only required if this provider is used

        api_key = api_key or get_api_key("groq")
        if not api_key:
            raise ProviderError(
                "No Groq API key found. Set GROQ_API_KEY in your environment, "
                "or run `missdata --set-key groq` to store one."
            )
        normalize_proxy_environment()
        try:
            self.client = Groq(api_key=api_key)
        except Exception as error:  # noqa: BLE001 -- SDK validates proxy configuration at startup
            raise provider_startup_error("Groq", error) from error
        self.settings = settings
        self.on_text = on_text or (lambda s: None)

    def make_system_message(self, content: str) -> dict:
        return {"role": "system", "content": content}

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    # gpt-oss models on Groq occasionally misfire when generating a tool
    # call: either the arguments aren't valid JSON, or the model reaches for
    # a tool name from its own training data (e.g. `repo_browser.open_file`)
    # that was never offered in this request's tool list. Groq's server
    # rejects the whole streamed response when this happens rather than
    # returning a normal (if broken) tool call we could catch and handle
    # ourselves. Both are transient generation glitches, not real failures —
    # so on either one, feed the model a short correction and let it retry,
    # instead of killing the user's turn outright.
    _UNKNOWN_TOOL_RE = re.compile(r"attempted to call tool '([^']+)' which was not in request\.tools")
    _MALFORMED_ARGS_MARKERS = ("failed to parse tool call arguments as json", "tool_use_failed")
    _MAX_GENERATION_RECOVERY_ATTEMPTS = 2

    def _generation_recovery_note(self, error: Exception) -> str | None:
        """Return a corrective note to feed back to the model if `error` looks
        like a recoverable gpt-oss generation glitch, else None. Returning
        None means: don't blindly retry — surface the error as-is, since
        retrying real failures (auth, quota, network) would just hide them."""
        message = str(error)
        unknown_tool = self._UNKNOWN_TOOL_RE.search(message)
        if unknown_tool:
            return (
                f"Your last tool call used '{unknown_tool.group(1)}', which is not one "
                "of the tools available in this conversation. Only call tools from the "
                "list you were given, using their exact names."
            )
        if any(marker in message.lower() for marker in self._MALFORMED_ARGS_MARKERS):
            return (
                "Your last tool call's arguments were not valid JSON, so it could not "
                "run. Retry the same action with correctly escaped, valid JSON "
                "arguments — double-check quotes and newlines inside any string values."
            )
        return None

    @staticmethod
    def tool_schemas_native(tool_schemas: list[dict]) -> list[dict]:
        return [
            {"type": "function", "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }}
            for t in tool_schemas
        ]

    def stream_turn(self, messages: list[dict], tool_schemas: list[dict]) -> StreamResult:
        return self._stream_turn_attempt(messages, tool_schemas, attempt=0)

    def _stream_turn_attempt(self, messages: list[dict], tool_schemas: list[dict], attempt: int) -> StreamResult:
        completion = self._create_completion(messages, tool_schemas)

        text = ""
        tool_calls: dict[int, dict] = {}

        try:
            for chunk in completion:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                if delta.content:
                    self.on_text(delta.content)
                    text += delta.content

                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_calls:
                            tool_calls[idx] = {"id": None, "name": "", "arguments": ""}
                        if tc.id:
                            tool_calls[idx]["id"] = tc.id
                        if tc.function and tc.function.name:
                            tool_calls[idx]["name"] += tc.function.name
                        if tc.function and tc.function.arguments:
                            tool_calls[idx]["arguments"] += tc.function.arguments
        except Exception as e:  # noqa: BLE001 — mid-stream errors (e.g. tool-call
            # validation failures from a hallucinated tool name) must not crash
            # the CLI; surface them the same way a request-time error would.
            recovery_note = self._generation_recovery_note(e)
            if recovery_note and attempt < self._MAX_GENERATION_RECOVERY_ATTEMPTS:
                ui.print_info(f"\n↻ Retrying — the model's last tool call didn't go through: {recovery_note}")
                # Retry on a local copy so this correction never pollutes the
                # real, persisted conversation history — from the caller's
                # point of view this call either just succeeds or raises,
                # exactly as before.
                retry_messages = messages + [self.make_user_message(f"(system note) {recovery_note}")]
                return self._stream_turn_attempt(retry_messages, tool_schemas, attempt + 1)
            raise ProviderError(f"Groq API error (mid-stream): {e}") from e

        ordered = [tool_calls[i] for i in sorted(tool_calls.keys())]
        calls = [ToolCall(id=tc["id"] or f"call_{i}", name=tc["name"], arguments=tc["arguments"])
                 for i, tc in enumerate(ordered)]
        return StreamResult(text=text, tool_calls=calls)

    def _create_completion(self, messages: list[dict], tool_schemas: list[dict]):
        """Create a streamed completion, retrying errors that are often transient.

        Groq's SDK retries some failures itself, but a gateway 403 can also be a
        short-lived edge/WAF failure. A single delayed retry avoids making the
        user manually resend while still surfacing persistent permission errors.
        """
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                return self.client.chat.completions.create(
                    model=self.settings.groq_model,
                    messages=messages,
                    temperature=1,
                    max_completion_tokens=self.settings.max_output_tokens,
                    top_p=1,
                    stream=True,
                    stop=None,
                    tools=self.tool_schemas_native(tool_schemas),
                )
            except Exception as error:  # noqa: BLE001 -- normalize provider SDK errors
                last_error = error
                status_code = getattr(error, "status_code", None)
                retryable = status_code in (403, 408, 409, 429) or status_code is None or status_code >= 500
                if not retryable or attempt:
                    break
                time.sleep(1)

        assert last_error is not None
        if getattr(last_error, "status_code", None) == 403:
            raise ProviderError(
                "Groq returned 403 Forbidden after one automatic retry. Verify that "
                "your GROQ_API_KEY is active and permitted to use "
                f"'{self.settings.groq_model}', then check your Groq account or network policy."
            ) from last_error
        raise ProviderError(f"Groq API error: {last_error}") from last_error

    def append_assistant_turn(self, messages: list[dict], result: StreamResult) -> None:
        if not result.tool_calls:
            messages.append({"role": "assistant", "content": result.text})
            return
        messages.append({
            "role": "assistant",
            "content": result.text or None,
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.name, "arguments": tc.arguments}}
                for tc in result.tool_calls
            ],
        })

    def append_tool_result(self, messages: list[dict], tool_call: ToolCall, result: str) -> None:
        messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})


# ---------------------------------------------------------------------------
# Anthropic (Messages API)
# ---------------------------------------------------------------------------

class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: Settings, on_text: Callable[[str], None] | None = None,
                 api_key: str | None = None):
        import anthropic  # local import: only required if this provider is used

        api_key = api_key or get_api_key("anthropic")
        if not api_key:
            raise ProviderError(
                "No Anthropic API key found. Set ANTHROPIC_API_KEY in your environment, "
                "or run `missdata --set-key anthropic` to store one."
            )
        normalize_proxy_environment()
        try:
            self.client = anthropic.Anthropic(api_key=api_key)
        except Exception as error:  # noqa: BLE001 -- SDK validates proxy configuration at startup
            raise provider_startup_error("Anthropic", error) from error
        self.settings = settings
        self.on_text = on_text or (lambda s: None)
        self._system = ""

    def make_system_message(self, content: str) -> dict:
        # Anthropic takes system as a top-level param, not a message.
        # We store it and return a no-op marker; agent.py should NOT append
        # this to the messages list for Anthropic. Handled via set_system().
        self._system = content
        return {"role": "system", "content": content, "_anthropic_system": True}

    def set_system(self, content: str) -> None:
        self._system = content

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": [{"type": "text", "text": content}]}

    @staticmethod
    def tool_schemas_native(tool_schemas: list[dict]) -> list[dict]:
        return [
            {"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
            for t in tool_schemas
        ]

    def stream_turn(self, messages: list[dict], tool_schemas: list[dict]) -> StreamResult:
        # Filter out any system-marker messages; Anthropic system goes as a param.
        native_messages = [m for m in messages if not m.get("_anthropic_system")]

        text = ""
        tool_calls: list[ToolCall] = []

        try:
            with self.client.messages.stream(
                model=self.settings.anthropic_model,
                max_tokens=self.settings.max_output_tokens,
                system=self._system,
                messages=native_messages,
                tools=self.tool_schemas_native(tool_schemas),
            ) as stream:
                for event in stream:
                    if event.type == "content_block_delta":
                        if event.delta.type == "text_delta":
                            self.on_text(event.delta.text)
                            text += event.delta.text
                final = stream.get_final_message()
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"Anthropic API error: {e}") from e

        for block in final.content:
            if block.type == "tool_use":
                tool_calls.append(ToolCall(
                    id=block.id, name=block.name, arguments=json.dumps(block.input),
                ))

        return StreamResult(text=text, tool_calls=tool_calls, stop_reason=final.stop_reason)

    def append_assistant_turn(self, messages: list[dict], result: StreamResult) -> None:
        content: list[dict] = []
        if result.text:
            content.append({"type": "text", "text": result.text})
        for tc in result.tool_calls:
            try:
                parsed_input = json.loads(tc.arguments) if tc.arguments else {}
            except json.JSONDecodeError:
                parsed_input = {}
            content.append({"type": "tool_use", "id": tc.id, "name": tc.name, "input": parsed_input})
        messages.append({"role": "assistant", "content": content})

    def append_tool_result(self, messages: list[dict], tool_call: ToolCall, result: str) -> None:
        # Anthropic expects tool_results grouped in a single user message per
        # batch, but appending one user message per tool_result also works
        # and is simpler to reason about; the API accepts consecutive user
        # messages being merged is NOT required — but multiple tool_result
        # blocks *should* share one user turn. We handle batching in agent.py
        # by calling append_tool_results_batch instead when there are >1.
        messages.append({
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tool_call.id, "content": result}],
        })

    def append_tool_results_batch(self, messages: list[dict], pairs: list[tuple[ToolCall, str]]) -> None:
        messages.append({
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": tc.id, "content": result}
                for tc, result in pairs
            ],
        })


# ---------------------------------------------------------------------------
# Ollama (local models, OpenAI-style chat message shape over Ollama's own
# /api/chat endpoint — no API key, no network egress, no per-minute token
# limits). Implemented with stdlib urllib only, so no new dependency is
# required just to support a local model.
# ---------------------------------------------------------------------------

class OllamaProvider:
    name = "ollama"

    def __init__(self, settings: Settings, on_text: Callable[[str], None] | None = None):
        self.settings = settings
        self.base_url = (settings.ollama_base_url or "http://localhost:11434").rstrip("/")
        self.on_text = on_text or (lambda s: None)

    def make_system_message(self, content: str) -> dict:
        return {"role": "system", "content": content}

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    @staticmethod
    def tool_schemas_native(tool_schemas: list[dict]) -> list[dict]:
        # Ollama's /api/chat accepts the same {"type": "function", "function": {...}}
        # shape as OpenAI/Groq.
        return [
            {"type": "function", "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }}
            for t in tool_schemas
        ]

    def stream_turn(self, messages: list[dict], tool_schemas: list[dict]) -> StreamResult:
        import urllib.error
        import urllib.request

        # Ollama messages are plain {"role", "content"} dicts, but a prior
        # assistant turn with tool_calls or a tool-result message from this
        # same provider already matches that shape (see append_* below), so
        # no conversion is needed here.
        payload = {
            "model": self.settings.ollama_model,
            "messages": messages,
            "stream": True,
            "tools": self.tool_schemas_native(tool_schemas),
            "options": {"num_predict": self.settings.max_output_tokens},
        }
        if self.settings.ollama_num_gpu is not None:
            # Overrides Ollama's automatic (conservative) VRAM-fit decision.
            # Useful on small GPUs where the auto-fit algorithm reserves more
            # headroom than the card actually has and falls back to 0 layers.
            payload["options"]["num_gpu"] = self.settings.ollama_num_gpu
        if self.settings.ollama_num_ctx is not None:
            payload["options"]["num_ctx"] = self.settings.ollama_num_ctx
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        text = ""
        tool_calls: list[dict] = []

        try:
            resp = urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001 — best-effort only
                pass
            if e.code == 404:
                raise ProviderError(
                    f"Ollama returned 404 for model '{self.settings.ollama_model}'. "
                    f"It likely isn't pulled yet — run `ollama pull {self.settings.ollama_model}`, "
                    f"or check the exact tag with `ollama list`. ({body})"
                ) from e
            raise ProviderError(f"Ollama HTTP error {e.code}: {body or e}") from e
        except urllib.error.URLError as e:
            raise ProviderError(
                f"Could not reach Ollama at {self.base_url} ({e}). "
                f"Is it running? Try `ollama serve`, and make sure the model is "
                f"pulled: `ollama pull {self.settings.ollama_model}`."
            ) from e

        try:
            with resp:
                for raw_line in resp:
                    line = raw_line.decode("utf-8").strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if "error" in chunk:
                        raise ProviderError(f"Ollama error: {chunk['error']}")

                    message = chunk.get("message") or {}
                    content = message.get("content")
                    if content:
                        self.on_text(content)
                        text += content

                    for tc in message.get("tool_calls") or []:
                        fn = tc.get("function", {})
                        args = fn.get("arguments", {})
                        # Ollama returns already-parsed JSON args (a dict), not a
                        # raw string like OpenAI/Groq — normalize to a JSON string
                        # so the rest of the app (ToolCall.arguments) is uniform.
                        args_str = args if isinstance(args, str) else json.dumps(args)
                        tool_calls.append({
                            "id": f"call_{len(tool_calls)}",
                            "name": fn.get("name", ""),
                            "arguments": args_str,
                        })

                    if chunk.get("done"):
                        break
        except ProviderError:
            raise
        except Exception as e:  # noqa: BLE001 — mid-stream errors must not crash the CLI
            raise ProviderError(f"Ollama error (mid-stream): {e}") from e

        calls = [ToolCall(id=tc["id"], name=tc["name"], arguments=tc["arguments"]) for tc in tool_calls]
        return StreamResult(text=text, tool_calls=calls)

    def append_assistant_turn(self, messages: list[dict], result: StreamResult) -> None:
        if not result.tool_calls:
            messages.append({"role": "assistant", "content": result.text})
            return
        messages.append({
            "role": "assistant",
            "content": result.text or "",
            "tool_calls": [
                {"function": {"name": tc.name, "arguments": json.loads(tc.arguments) if tc.arguments else {}}}
                for tc in result.tool_calls
            ],
        })

    def append_tool_result(self, messages: list[dict], tool_call: ToolCall, result: str) -> None:
        # Ollama identifies tool results by role + content, matched to the
        # preceding tool_calls by position/name rather than an id.
        messages.append({"role": "tool", "content": result})


# ---------------------------------------------------------------------------
# Generic OpenAI-compatible providers (DeepSeek, OpenAI, OpenRouter,
# Together AI, Mistral, Fireworks, xAI, Moonshot, Perplexity, or any
# "custom" endpoint) — one implementation drives all of them since they all
# speak the same /chat/completions request shape and SSE streaming format.
# Implemented with stdlib urllib only (same pattern as OllamaProvider) so
# adding a new preset never requires a new dependency.
# ---------------------------------------------------------------------------

class OpenAICompatibleProvider:
    def __init__(self, settings: Settings, on_text: Callable[[str], None] | None = None,
                 api_key: str | None = None):
        self.settings = settings
        self.on_text = on_text or (lambda s: None)

        if settings.provider == "custom":
            self.name = "custom"
            self.label = "Custom endpoint"
            self.base_url = (settings.custom_base_url or "").rstrip("/")
            self.model = settings.custom_model
            key_env = settings.custom_api_key_env or "CUSTOM_API_KEY"
            if not self.base_url:
                raise ProviderError(
                    "No base URL configured for the custom provider. Set it with "
                    "`/base-url <https://...>` or settings.custom_base_url, then "
                    "set the model with `/model <name>`."
                )
        else:
            preset = OPENAI_COMPATIBLE_PRESETS.get(settings.provider)
            if preset is None:
                raise ProviderError(f"Unknown OpenAI-compatible provider: {settings.provider}")
            self.name = settings.provider
            self.label = preset["label"]
            self.base_url = preset["base_url"].rstrip("/")
            self.model = settings.model  # honors any per-provider override, else preset default
            key_env = preset["env_var"]

        api_key = api_key or get_api_key(settings.provider)
        if not api_key:
            raise ProviderError(
                f"No {self.label} API key found. Set {key_env} in your environment, "
                f"or run `missdata --set-key {settings.provider}`."
            )
        self.api_key = api_key
        normalize_proxy_environment()

    def make_system_message(self, content: str) -> dict:
        return {"role": "system", "content": content}

    def make_user_message(self, content: str) -> dict:
        return {"role": "user", "content": content}

    @staticmethod
    def tool_schemas_native(tool_schemas: list[dict]) -> list[dict]:
        return [
            {"type": "function", "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }}
            for t in tool_schemas
        ]

    def stream_turn(self, messages: list[dict], tool_schemas: list[dict]) -> StreamResult:
        import urllib.error
        import urllib.request

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "max_tokens": self.settings.max_output_tokens,
        }
        if tool_schemas:
            payload["tools"] = self.tool_schemas_native(tool_schemas)

        url = f"{self.base_url}/chat/completions"
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "Accept": "text/event-stream",
            },
            method="POST",
        )

        try:
            response = urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as error:
            body = ""
            try:
                body = error.read().decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001 -- best-effort only
                pass
            if error.code == 401 or error.code == 403:
                raise ProviderError(
                    f"{self.label} rejected the API key (HTTP {error.code}). "
                    f"Check the key you saved for '{self.name}'. ({body[:300]})"
                ) from error
            if error.code == 404:
                raise ProviderError(
                    f"{self.label} returned 404 for model '{self.model}'. It may be "
                    f"renamed or unavailable on your plan — set a different one with "
                    f"`/model <name>`. ({body[:300]})"
                ) from error
            if error.code == 429:
                raise ProviderError(f"{self.label} rate limit hit (429). Try again shortly.") from error
            raise ProviderError(f"{self.label} HTTP error {error.code}: {body[:300] or error}") from error
        except urllib.error.URLError as error:
            raise ProviderError(f"Could not reach {self.label} at {self.base_url} ({error}).") from error

        text = ""
        tool_calls: dict[int, dict] = {}

        try:
            with response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue

                    if "error" in chunk:
                        raise ProviderError(f"{self.label} error: {chunk['error']}")

                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}

                    content = delta.get("content")
                    if content:
                        self.on_text(content)
                        text += content

                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        if idx not in tool_calls:
                            tool_calls[idx] = {"id": None, "name": "", "arguments": ""}
                        if tc.get("id"):
                            tool_calls[idx]["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            tool_calls[idx]["name"] += fn["name"]
                        if fn.get("arguments"):
                            tool_calls[idx]["arguments"] += fn["arguments"]
        except ProviderError:
            raise
        except Exception as error:  # noqa: BLE001 -- mid-stream errors must not crash the CLI
            raise ProviderError(f"{self.label} error (mid-stream): {error}") from error

        ordered = [tool_calls[i] for i in sorted(tool_calls.keys())]
        calls = [ToolCall(id=tc["id"] or f"call_{i}", name=tc["name"], arguments=tc["arguments"])
                 for i, tc in enumerate(ordered)]
        return StreamResult(text=text, tool_calls=calls)

    def append_assistant_turn(self, messages: list[dict], result: StreamResult) -> None:
        if not result.tool_calls:
            messages.append({"role": "assistant", "content": result.text})
            return
        messages.append({
            "role": "assistant",
            "content": result.text or None,
            "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.name, "arguments": tc.arguments}}
                for tc in result.tool_calls
            ],
        })

    def append_tool_result(self, messages: list[dict], tool_call: ToolCall, result: str) -> None:
        messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})


def make_provider(settings: Settings, on_text: Callable[[str], None] | None = None,
                  api_key: str | None = None):
    """Construct a provider, optionally with one key selected from a key pool."""
    if settings.provider == "groq":
        return GroqProvider(settings, on_text=on_text, api_key=api_key)
    if settings.provider == "anthropic":
        return AnthropicProvider(settings, on_text=on_text, api_key=api_key)
    if settings.provider == "ollama":
        return OllamaProvider(settings, on_text=on_text)
    if settings.provider == "custom" or settings.provider in OPENAI_COMPATIBLE_PRESETS:
        return OpenAICompatibleProvider(settings, on_text=on_text, api_key=api_key)
    raise ProviderError(f"Unknown provider: {settings.provider}")
