"""
Core agent loop for Miss Data.
"""

from __future__ import annotations

import json
import os
import platform
import sys
from pathlib import Path

from . import memory, tools, ui
from .activity import ActivityLogger
from .config import OPENAI_COMPATIBLE_PRESETS, Settings, get_api_key, get_api_keys
from .providers import ProviderError, ToolCall, make_provider

SYSTEM_PROMPT_PATH = Path(__file__).parent / "system_prompt.md"


def load_system_prompt_template() -> str:
    try:
        return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return "You are Miss Data, a helpful coding agent. Always respond in {response_language}. {memory_facts}"


def build_system_prompt(cwd: str, language: str = "en") -> str:
    template = load_system_prompt_template()
    shell_name = os.environ.get("SHELL") or os.environ.get("COMSPEC") or "unknown"
    return (
        template
        .replace("{os_name}", f"{platform.system()} {platform.release()}")
        .replace("{cwd}", cwd)
        .replace("{shell_name}", shell_name)
        .replace("{response_language}", "Persian (فارسی)" if language == "fa" else "English")
        .replace("{memory_facts}", memory.facts_as_text())
    )


class Agent:
    def __init__(self, settings: Settings, cwd: str | None = None,
                 allow_provider_switch_prompt: bool = True):
        self.settings = settings
        self.allow_provider_switch_prompt = allow_provider_switch_prompt
        self.cwd = str(Path(cwd or os.getcwd()).resolve())
        # The sandbox root is the boundary filesystem tools are confined to
        # when settings.sandbox_mode is True. It tracks cwd (see change_cwd) —
        # /cwd is a deliberate user action, so re-pointing the sandbox at the
        # new directory is the same trust decision as launching there.
        self.sandbox_root = self.cwd
        self.messages: list[dict] = []
        self.always_approved: set[str] = set()  # tool names approved for "this session"
        self._touched_files: "set[str]" = set()  # files created/edited/deleted/moved this turn
        self.logger = ActivityLogger()
        self._provider = None
        self._active_api_key: str | None = None
        self._spinner = ui.ThinkingSpinner()
        self._marker_shown = False  # has "Miss Data ›" been printed for the current turn yet?
        self._tool_calls_completed = 0
        self._init_provider()
        self._reset_system_message()
        self.logger.event(
            "agent_initialized", provider=self.settings.provider, model=self.settings.model,
            cwd=self.cwd, sandbox_mode=self.settings.sandbox_mode, log_file=str(self.logger.path),
        )

    # -- provider / session management -----------------------------------

    def _init_provider(self, api_key: str | None = None) -> None:
        """Build the active provider with one selected key from its ordered pool."""
        self._active_api_key = api_key or get_api_key(self.settings.provider)
        self._provider = make_provider(
            self.settings, on_text=self._on_text_chunk, api_key=self._active_api_key,
        )
        self.logger.event(
            "provider_initialized", provider=self.settings.provider, model=self.settings.model,
            api_key_fingerprint=ActivityLogger.key_fingerprint(self._active_api_key),
        )

    def _ensure_marker_shown(self) -> None:
        """Print the "Miss Data ›" banner at most once per turn, right before
        the first thing the turn actually produces (text or a tool call) —
        rather than once per model round-trip, which reads as several
        separate replies for what is really one continuous turn."""
        if not self._marker_shown:
            ui.print_agent_marker()
            self._marker_shown = True

    def _on_text_chunk(self, chunk: str) -> None:
        self._spinner.stop()  # first real output — stop showing "thinking"
        self._ensure_marker_shown()
        print(chunk, end="", flush=True)

    def _reset_system_message(self) -> None:
        system_content = build_system_prompt(self.cwd, self.settings.language)
        # Always strip any leftover system-role message first — the message
        # list may carry a Groq-style system message from before a provider
        # switch, which Anthropic must never see mixed into `messages`.
        self.messages = [m for m in self.messages if m.get("role") != "system"]
        if self.settings.provider == "anthropic":
            self._provider.set_system(system_content)
        else:
            # Groq, Ollama, and all OpenAI-compatible providers (DeepSeek,
            # OpenRouter, custom, ...) use a plain system message first in
            # the list rather than a separate top-level `system` field.
            self.messages.insert(0, self._provider.make_system_message(system_content))

    def switch_provider(self, provider_name: str) -> None:
        # Message formats (tool-call shape, content blocks) are not
        # compatible across providers, so switching starts a fresh
        # conversation. Long-term memory (facts) is unaffected. Keep the old
        # provider intact if construction of the new client fails.
        previous_provider = self.settings.provider
        previous_messages = self.messages
        previous_api_key = self._active_api_key
        self.settings.provider = provider_name
        try:
            self._init_provider()
        except Exception:
            self.settings.provider = previous_provider
            self.messages = previous_messages
            self._active_api_key = previous_api_key
            raise
        self.messages = []
        self.settings.save()
        self._reset_system_message()
        self.logger.event(
            "provider_switched", from_provider=previous_provider, to_provider=provider_name,
            model=self.settings.model,
        )

    def clear_conversation(self) -> None:
        self.messages = []
        self.always_approved.clear()
        self._reset_system_message()
        self.logger.event("conversation_cleared")

    def compact_context(self, keep_recent_turns: int = 0) -> dict:
        """Shrink the conversation by folding older messages into one summary.

        A "turn" is a user message plus everything that follows it up to
        (not including) the next user message — i.e. the model's reply and
        any tool calls/results along the way. Cutting only at turn
        boundaries guarantees every tool_use/tool_result stays paired, for
        every provider's message shape.

        keep_recent_turns=0 (default) folds the whole conversation into a
        single summary. A higher number keeps that many of the most recent
        turns verbatim after the summary, at the cost of less compaction.

        Returns {"before": int, "after": int, "kept_turns": int} — message
        counts (excluding the system message) before and after. Raises
        ValueError if there isn't enough conversation yet to compact, or
        ProviderError if the summarization call itself fails.
        """
        non_system = [m for m in self.messages if m.get("role") != "system"]

        turns: list[list[dict]] = []
        for m in non_system:
            if m.get("role") == "user":
                turns.append([m])
            elif turns:
                turns[-1].append(m)
            else:
                turns.append([m])  # stray leading non-user message; keep it somewhere

        if len(turns) < 2:
            raise ValueError("Not enough conversation yet to compact.")

        keep_recent_turns = max(0, min(keep_recent_turns, len(turns) - 1))
        split_at = len(turns) - keep_recent_turns
        turns_to_summarize = turns[:split_at]
        kept_turns = turns[split_at:]

        messages_to_summarize = [m for t in turns_to_summarize for m in t]
        before_count = len(non_system)

        summary_request = self._provider.make_user_message(
            "Summarize everything above into a concise briefing note for yourself to "
            "continue this task with no other context: the user's goal, decisions "
            "made, specific files/functions/code touched and how, and any open next "
            "steps. Do not ask questions or add commentary — output only the summary."
        )
        request_messages = messages_to_summarize + [summary_request]

        self._marker_shown = False
        self._spinner.start()
        try:
            result = self._provider.stream_turn(request_messages, [])
        finally:
            self._spinner.stop()

        summary_text = result.text.strip()
        if not summary_text:
            raise ProviderError("The model returned an empty summary; nothing was compacted.")

        self.messages = []
        self._reset_system_message()
        self.messages.append(self._provider.make_user_message(
            f"(Earlier conversation was compacted to save context. Summary of what happened before this point:)\n\n{summary_text}"
        ))
        for t in kept_turns:
            self.messages.extend(t)

        after_count = 1 + sum(len(t) for t in kept_turns)
        return {"before": before_count, "after": after_count, "kept_turns": len(kept_turns)}

    def change_cwd(self, new_cwd: str) -> str:
        p = Path(new_cwd).expanduser()
        if not p.is_absolute():
            p = Path(self.cwd) / p
        p = p.resolve()
        if not p.exists() or not p.is_dir():
            raise FileNotFoundError(f"Not a directory: {p}")
        self.cwd = str(p)
        self.sandbox_root = self.cwd
        self._reset_system_message()
        self.logger.event("working_directory_changed", cwd=self.cwd)
        return self.cwd

    # -- tool execution with approval gating -------------------------------

    def _needs_approval(self, tool_name: str) -> bool:
        mode = self.settings.approval_mode
        if mode == "auto":
            return False
        if tool_name in self.always_approved:
            return False
        if mode == "always":
            return True
        # mode == "risky"
        return tool_name in tools.RISKY_TOOLS

    def _execute_tool(self, name: str, arguments_json: str) -> str:
        try:
            args = json.loads(arguments_json) if arguments_json else {}
        except json.JSONDecodeError:
            result = f"Error: could not parse arguments for {name}: {arguments_json!r}"
            self.logger.event("tool_failed", tool=name, reason="invalid_arguments", result=result)
            return result

        self.logger.event("tool_requested", tool=name, arguments=args, cwd=self.cwd)
        if name == "remember_fact":
            fact = args.get("fact", "").strip()
            if not fact:
                result = "Error: no fact provided."
                self.logger.event("tool_failed", tool=name, reason="missing_fact", result=result)
                return result
            memory.add_fact(fact)
            self._reset_system_message()  # keep memory in sync for next turn
            result = f"Remembered: {fact}"
            self.logger.event("tool_completed", tool=name, result=result)
            return result

        impl = tools.TOOL_IMPLEMENTATIONS.get(name)
        if impl is None:
            result = f"Error: unknown tool '{name}'."
            self.logger.event("tool_failed", tool=name, reason="unknown_tool", result=result)
            return result

        description = tools.describe_call(name, args)
        risky = name in tools.RISKY_TOOLS
        self._ensure_marker_shown()
        ui.print_tool_call(description, risky=risky)

        if self._needs_approval(name):
            approved = self._ask_approval_interactive(description)
            self.logger.event("tool_approval", tool=name, approved=approved, description=description)
            if not approved:
                result = "User declined to approve this action. Do not repeat it; ask the user how they'd like to proceed instead."
                self.logger.event("tool_declined", tool=name, result=result)
                return result

        try:
            result = impl(
                args, self.cwd,
                sandbox_root=self.sandbox_root,
                sandbox_enabled=self.settings.sandbox_mode,
            )
        except tools.ToolError as e:
            result = f"Error: {e}"
        except Exception as e:  # noqa: BLE001 — tool failures must not crash the agent
            result = f"Unexpected error running {name}: {e}"

        if not result.startswith(("Error:", "Unexpected error")):
            self._track_touched_files(name, args)

        self._tool_calls_completed += 1
        self.logger.event(
            "tool_completed", tool=name, risky=risky, arguments=args, result=result,
            touched_files=sorted(self._touched_files),
        )
        ui.print_tool_result(result)
        return result

    def _track_touched_files(self, name: str, args: dict) -> None:
        for key in tools.FILE_MUTATION_ARGS.get(name, ()):
            value = args.get(key)
            if value:
                self._touched_files.add(
                    tools.resolve_display(value, self.cwd, self.sandbox_root, self.settings.sandbox_mode)
                )

    def _ask_approval_interactive(self, description: str) -> bool:
        try:
            answer = input(ui.yellow(f"\n⚠ Approval needed: ") + description +
                            ui.dim("\n  Proceed? [y/N/a=always this session]: ")).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return False
        if answer in ("a", "always"):
            return True
        return answer in ("y", "yes")

    # -- provider resilience -------------------------------------------------

    @staticmethod
    def _provider_label(provider: str) -> str:
        if provider == "groq":
            return "Groq"
        if provider == "anthropic":
            return "Anthropic"
        if provider == "ollama":
            return "Ollama (local)"
        if provider == "custom":
            return "Custom endpoint"
        return OPENAI_COMPATIBLE_PRESETS.get(provider, {}).get("label", provider)

    def _provider_model(self, provider: str) -> str:
        if provider == "groq":
            return self.settings.groq_model
        if provider == "anthropic":
            return self.settings.anthropic_model
        if provider == "ollama":
            return self.settings.ollama_model
        if provider == "custom":
            return self.settings.custom_model
        preset = OPENAI_COMPATIBLE_PRESETS.get(provider, {})
        return self.settings.openai_compatible_models.get(provider) or preset.get("default_model", "default")

    def _rotate_to_next_key(self, tried_key_fingerprints: set[str | None]) -> bool:
        """Rebuild the current provider with the next configured, unused key."""
        provider = self.settings.provider
        for index, api_key in enumerate(get_api_keys(provider), start=1):
            fingerprint = ActivityLogger.key_fingerprint(api_key)
            if fingerprint in tried_key_fingerprints:
                continue
            tried_key_fingerprints.add(fingerprint)
            self.logger.event(
                "api_key_rotation_attempted", provider=provider, key_position=index,
                api_key_fingerprint=fingerprint,
            )
            try:
                self._init_provider(api_key=api_key)
            except ProviderError as error:
                self.logger.event(
                    "api_key_rotation_failed", provider=provider, key_position=index,
                    api_key_fingerprint=fingerprint, error=str(error),
                )
                continue
            ui.print_info(f"\nRetrying with another configured {self._provider_label(provider)} API key...")
            self.logger.event(
                "api_key_rotated", provider=provider, key_position=index,
                api_key_fingerprint=fingerprint,
            )
            return True
        return False

    def _available_fallback_providers(self, attempted_providers: set[str]) -> list[str]:
        available: list[str] = []
        for provider in self.settings.fallback_providers:
            if provider in attempted_providers:
                continue
            if provider == "custom" and not self.settings.custom_base_url:
                continue
            if get_api_keys(provider):
                available.append(provider)
        return available

    def _ask_provider_failover(self, failed_provider: str, error: ProviderError,
                               candidates: list[str]) -> str | None:
        """Ask before switching companies; decline and EOF both mean no switch."""
        candidate = candidates[0]
        if not self.allow_provider_switch_prompt:
            self.logger.event(
                "provider_switch_not_prompted", from_provider=failed_provider,
                to_provider=candidate, error=str(error), reason="non_interactive_session",
            )
            return None
        failed_label = self._provider_label(failed_provider)
        candidate_label = self._provider_label(candidate)
        note = ""
        if self._tool_calls_completed:
            note = (
                f" This turn already performed {self._tool_calls_completed} tool action(s); "
                "switching starts a fresh provider conversation and may repeat them."
            )
        print()
        ui.print_info(
            f"{failed_label} could not complete this request: {error}.{note}"
        )
        try:
            answer = input(
                ui.yellow(
                    f"Switch to {candidate_label} ({self._provider_model(candidate)}) and retry your request? [y/N]: "
                )
            ).strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            answer = ""
        approved = answer in ("y", "yes")
        self.logger.event(
            "provider_switch_prompt", from_provider=failed_provider, to_provider=candidate,
            approved=approved, error=str(error), tool_actions_completed=self._tool_calls_completed,
        )
        return candidate if approved else None

    # -- main turn loop ------------------------------------------------------

    def run_turn(self, user_input: str) -> None:
        self.messages.append(self._provider.make_user_message(user_input))
        self._touched_files = set()
        self._marker_shown = False
        self._tool_calls_completed = 0
        attempted_providers: set[str] = {self.settings.provider}
        tried_keys: dict[str, set[str | None]] = {
            self.settings.provider: {ActivityLogger.key_fingerprint(self._active_api_key)}
        }
        self.logger.event(
            "turn_started", user_input=user_input, provider=self.settings.provider,
            model=self.settings.model,
        )

        max_iterations = 25  # guard against runaway tool-call loops
        for iteration in range(max_iterations):
            self._spinner.start()
            self.logger.event(
                "provider_request_started", provider=self.settings.provider, model=self.settings.model,
                iteration=iteration + 1, message_count=len(self.messages),
                api_key_fingerprint=ActivityLogger.key_fingerprint(self._active_api_key),
            )
            try:
                result = self._provider.stream_turn(self.messages, tools.TOOL_SCHEMAS + [REMEMBER_FACT_SCHEMA])
            except ProviderError as error:
                self._spinner.stop()
                failed_provider = self.settings.provider
                self.logger.event(
                    "provider_request_failed", provider=failed_provider, model=self.settings.model,
                    error=str(error), api_key_fingerprint=ActivityLogger.key_fingerprint(self._active_api_key),
                )
                current_tried_keys = tried_keys.setdefault(failed_provider, set())
                if self._rotate_to_next_key(current_tried_keys):
                    continue

                candidate = self._ask_provider_failover(
                    failed_provider, error, self._available_fallback_providers(attempted_providers),
                ) if self._available_fallback_providers(attempted_providers) else None
                if candidate:
                    attempted_providers.add(candidate)
                    try:
                        self.switch_provider(candidate)
                    except ProviderError as switch_error:
                        self.logger.event(
                            "provider_switch_failed", from_provider=failed_provider,
                            to_provider=candidate, error=str(switch_error),
                        )
                        # Avoid getting stuck if an alternative is misconfigured.
                        attempted_providers.add(candidate)
                        continue
                    tried_keys[candidate] = {ActivityLogger.key_fingerprint(self._active_api_key)}
                    self.messages.append(self._provider.make_user_message(user_input))
                    self._marker_shown = False
                    ui.print_info(f"Retrying your request with {self._provider_label(candidate)}...")
                    continue

                self._ensure_marker_shown()
                print()
                ui.print_error(str(error))
                self.logger.event("turn_failed", provider=failed_provider, error=str(error))
                return
            finally:
                self._spinner.stop()  # no-op if _on_text_chunk already stopped it

            self.logger.event(
                "provider_response_received", provider=self.settings.provider, text=result.text,
                tool_calls=[{"name": call.name, "arguments": call.arguments} for call in result.tool_calls],
            )
            if not result.tool_calls:
                self._provider.append_assistant_turn(self.messages, result)
                print()
                ui.print_files_summary(sorted(self._touched_files))
                self.logger.event(
                    "turn_completed", provider=self.settings.provider, answer=result.text,
                    touched_files=sorted(self._touched_files),
                )
                return

            self._provider.append_assistant_turn(self.messages, result)

            if self.settings.provider == "anthropic":
                pairs = []
                for tc in result.tool_calls:
                    tool_result = self._execute_tool(tc.name, tc.arguments)
                    pairs.append((tc, tool_result))
                self._provider.append_tool_results_batch(self.messages, pairs)
            else:
                for tc in result.tool_calls:
                    tool_result = self._execute_tool(tc.name, tc.arguments)
                    self._provider.append_tool_result(self.messages, tc, tool_result)

        self._ensure_marker_shown()
        ui.print_info("\n(Stopped after reaching the maximum number of tool-call steps for one turn.)")
        ui.print_files_summary(sorted(self._touched_files))
        self.logger.event("turn_stopped", reason="maximum_iterations", touched_files=sorted(self._touched_files))


REMEMBER_FACT_SCHEMA = {
    "name": "remember_fact",
    "description": "Save a short, durable fact about the user or the project (preferences, conventions, stack choices) so it's available in future sessions. Don't store trivial or one-off details.",
    "parameters": {
        "type": "object",
        "properties": {
            "fact": {"type": "string", "description": "A concise, self-contained fact to remember."}
        },
        "required": ["fact"],
    },
}
