"""
Miss Data CLI entry point.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path

from . import manual, memory, ui
from .activity import ActivityLogger
from .agent import Agent
from .config import (
    APPROVAL_MODES, BUDGET_PROFILES, CONTEXT_RECOVERY_MODES, EXECUTION_MODES, HISTORY_PATH, LOG_DIR, OLLAMA_RECOVERY_MODES, OPENAI_COMPATIBLE_PRESETS, PROVIDERS, Settings, WORK_PROFILES, ensure_dirs,
    delete_api_keys, export_settings, get_api_key, get_api_keys, import_settings, load_env, save_api_keys,
)
from .insights import format_project_change_summary, ollama_health, project_change_summary
from .providers import ProviderError
from . import sessions
from .terminal_input import TerminalInput
from .workflows import (
    discover_tests, estimate_context, git_checkpoint, git_diff, git_recent_checkpoints,
    git_restore_checkpoint, missdata_root, project_map, update_status, apply_update,
)


def _prompt_for_key(provider: str, append: bool = False,
                    logger: ActivityLogger | None = None) -> None:
    """Collect one or more keys. Keys are never echoed, printed, or logged."""
    if provider == "ollama":
        return  # local server, no API key involved
    if provider == "groq":
        label, env_var, url = "Groq", "GROQ_API_KEY", "https://console.groq.com/keys"
    elif provider == "anthropic":
        label, env_var, url = "Anthropic", "ANTHROPIC_API_KEY", "https://console.anthropic.com/settings/keys"
    elif provider in OPENAI_COMPATIBLE_PRESETS:
        preset = OPENAI_COMPATIBLE_PRESETS[provider]
        label, env_var, url = preset["label"], preset["env_var"], preset["signup_url"]
    elif provider == "custom":
        settings = Settings.load()
        env_var = settings.custom_api_key_env or "CUSTOM_API_KEY"
        label, url = "your custom endpoint", None
    else:
        return

    existing = get_api_keys(provider) if append else []
    pool_var = env_var + "S" if env_var.endswith("_KEY") else env_var + "_KEYS"
    if existing:
        print(ui.dim(f"\n{label} already has {len(existing)} configured key(s); new keys will be appended."))
    else:
        print(ui.yellow(f"\nNo {label} API key found ({env_var})."))
    if url:
        print(ui.dim(f"Get one at: {url}"))
    print(ui.dim(f"Multiple keys are stored in order in {pool_var}; the next key is tried after a failure."))

    new_keys: list[str] = []
    while True:
        try:
            key = getpass.getpass(f"Paste a {label} API key (or press Enter to finish): ").strip()
        except (EOFError, KeyboardInterrupt):
            key = ""
        if not key:
            break
        new_keys.append(key)
        try:
            more = input(ui.dim("Add another key? [y/N]: ")).strip().lower()
        except (EOFError, KeyboardInterrupt):
            more = ""
        if more not in ("y", "yes"):
            break

    if new_keys:
        save_api_keys(provider, existing + new_keys)
        if logger:
            logger.event(
                "api_key_pool_updated", provider=provider,
                key_count=len(existing) + len(new_keys), operation="append" if append else "replace",
            )
        print(ui.green(f"Saved {len(existing) + len(new_keys)} {label} key(s).\n"))
    else:
        if logger:
            logger.event("api_key_pool_update_cancelled", provider=provider, operation="append" if append else "replace")
        print(ui.dim("Skipped — set keys later with `missdata --set-key " + provider + "`.\n"))


def _masked_key(key: str) -> str:
    """Identify a configured credential without disclosing the credential."""
    if len(key) <= 8:
        visible = "•" * len(key)
    else:
        visible = f"{key[:4]}…{key[-4:]}"
    return f"{visible}  [{ActivityLogger.key_fingerprint(key)}]"


def _read_key_replacement(provider: str, position: int) -> str | None:
    """Read a replacement credential without echoing it or placing it in logs."""
    try:
        value = getpass.getpass(f"Paste replacement API key for {provider} key #{position} (Enter cancels): ").strip()
    except (EOFError, KeyboardInterrupt):
        value = ""
    return value or None


def _refresh_active_credentials(agent: Agent, provider: str) -> None:
    """Make key changes take effect immediately for the active provider."""
    if provider != agent.settings.provider:
        return
    if provider == "ollama":
        return
    keys = get_api_keys(provider)
    if not keys:
        agent._provider = None
        agent._active_api_key = None
        agent.logger.event("active_provider_credentials_removed", provider=provider)
        ui.print_info(f"No key remains for active provider {provider}; add a key or switch provider before the next request.")
        return
    try:
        agent._init_provider(api_key=keys[0])
    except ProviderError as error:
        ui.print_error(f"Saved keys, but could not initialize active provider: {error}")
    else:
        ui.print_info(f"Active provider {provider} refreshed with its first configured key.")


def _show_manual(topic: str) -> None:
    """Render a searchable man-style page without consuming model tokens."""
    query = topic.strip()
    if not query:
        print(ui.bold("\nMiss Data manual"))
        print(manual.index_text())
        print()
        return
    if query.lower().startswith("search "):
        results = manual.search(query[7:])
        if not results:
            ui.print_info("No manual topics matched. Try `/man` to see the index.")
        else:
            print(ui.bold("\nManual search results:"))
            for page in results:
                print(f"  {page.name:<18} {page.synopsis}")
            print(ui.dim("Open a page with `/man <topic>`."))
            print()
        return
    page = manual.lookup(query)
    if page is None:
        ui.print_error(f"No manual page for '{query}'. Use `/man` or `/man search {query}`.")
        return
    print("\n" + ui.bold(manual.render(page)))
    print()


def _save_session(agent: Agent) -> None:
    """Best-effort local conversation save; never blocks an answer or command."""
    try:
        if agent.session_title == "Untitled session":
            for message in agent.messages:
                if message.get("role") == "user" and isinstance(message.get("content"), str):
                    agent.session_title = message["content"].strip().replace("\n", " ")[:72] or agent.session_title
                    break
        sessions.save(
            agent.session_id, title=agent.session_title, cwd=agent.cwd,
            provider=agent.settings.provider, model=agent.settings.model,
            messages=agent.messages, activity_log=str(agent.logger.path),
        )
        agent.logger.event("session_saved", saved_session_id=agent.session_id)
    except (OSError, ValueError, TypeError) as error:
        agent.logger.event("session_save_failed", error=str(error))


def _resume_session(agent: Agent, settings: Settings, session_id: str) -> tuple[bool, str]:
    try:
        data = sessions.load(session_id)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return False, f"Could not load session: {error}"
    target_provider = str(data.get("provider", settings.provider))
    target_model = str(data.get("model", settings.model))
    previous_provider, previous_model, previous_messages = settings.provider, settings.model, agent.messages
    try:
        settings.provider = target_provider
        settings.model = target_model
        agent._init_provider()
    except ProviderError as error:
        settings.provider = previous_provider
        settings.model = previous_model
        agent.messages = previous_messages
        try:
            agent._init_provider()
        except ProviderError:
            pass
        return False, f"Saved session requires {target_provider}, but it could not initialize: {error}"
    agent.messages = list(data.get("messages", []))
    agent._reset_system_message()
    agent.session_id = session_id
    agent.session_title = str(data.get("title", "Untitled session"))
    settings.save()
    agent.logger.event("session_resumed", resumed_session_id=session_id, provider=target_provider)
    return True, f"Resumed session '{agent.session_title}' ({len(agent.messages)} messages)."


def ensure_api_key(settings: Settings) -> bool:
    if settings.provider == "ollama":
        return True  # nothing to check locally
    if settings.provider == "custom" and not settings.custom_base_url:
        ui.print_error("No base URL set for the custom provider. Use --base-url <https://...> or /base-url.")
        return False
    key = get_api_key(settings.provider)
    if key:
        return True
    _prompt_for_key(settings.provider)
    return get_api_key(settings.provider) is not None


def handle_slash_command(cmd: str, agent: Agent, settings: Settings) -> bool:
    """Returns False if the CLI should exit."""
    parts = cmd.strip().split(maxsplit=1)
    name = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""
    agent.logger.event("slash_command", command=name, arguments=rest)

    if name in ("/exit", "/quit"):
        return False

    if name == "/help":
        if rest.strip():
            _show_manual(rest)
        else:
            ui.print_help()
            print(ui.dim("Use `/man` for the full topic index or `/help <topic>` for a focused page."))

    elif name == "/man":
        _show_manual(rest)
        agent.logger.event("manual_requested", topic=rest.strip() or "index")

    elif name == "/update":
        action = rest.strip().lower() or "check"
        source_root = missdata_root()
        if action == "check":
            ui.print_info("Checking the trusted Miss Data source for updates...")
            ok, detail = update_status(source_root)
            (ui.print_info if ok else ui.print_error)(detail)
            agent.logger.event("self_update_checked", success=ok, detail=detail)
        elif action == "apply":
            ok, detail = update_status(source_root)
            if not ok:
                ui.print_error(detail)
            else:
                print(detail)
                try:
                    answer = input(ui.yellow("Fast-forward Miss Data from the trusted source now? Local source changes must be clean. [y/N]: ")).strip().lower()
                except (EOFError, KeyboardInterrupt):
                    answer = ""
                if answer not in ("y", "yes"):
                    ui.print_info("Self-update cancelled.")
                else:
                    updated, result = apply_update(source_root)
                    (ui.print_info if updated else ui.print_error)(result)
                    if updated:
                        ui.print_info("Restart Miss Data. If dependencies changed, run `pip install -r requirements.txt` in the Miss Data source directory.")
                    agent.logger.event("self_update_applied", success=updated, detail=result)
        else:
            ui.print_error("Usage: /update [check|apply]")

    elif name == "/export-config":
        target = Path(rest.strip() or "missdata-settings-backup.json")
        if not target.is_absolute():
            target = Path(agent.cwd) / target
        try:
            saved_path = export_settings(target, settings)
        except (OSError, ValueError) as error:
            ui.print_error(f"Could not export settings: {error}")
        else:
            ui.print_info(f"Settings exported to {saved_path}. API keys, logs, history, and sessions were not included.")
            agent.logger.event("settings_exported", path=str(saved_path))

    elif name == "/import-config":
        source = Path(rest.strip())
        if not rest.strip():
            ui.print_error("Usage: /import-config <settings-backup.json>")
        else:
            try:
                imported = import_settings(source)
            except (OSError, ValueError, json.JSONDecodeError) as error:
                ui.print_error(f"Could not import settings: {error}")
            else:
                ui.print_info(
                    f"Backup will set provider={imported.provider}, model={imported.model}, budget={imported.budget_profile}, "
                    f"and mode={imported.execution_mode}. API keys will remain unchanged."
                )
                try:
                    answer = input(ui.yellow("Apply these imported settings now? [y/N]: ")).strip().lower()
                except (EOFError, KeyboardInterrupt):
                    answer = ""
                if answer not in ("y", "yes"):
                    ui.print_info("Settings import cancelled.")
                else:
                    previous = {field: getattr(settings, field) for field in Settings.__dataclass_fields__}
                    try:
                        for field in Settings.__dataclass_fields__:
                            setattr(settings, field, getattr(imported, field))
                        agent._init_provider()
                    except ProviderError as error:
                        for field, value in previous.items():
                            setattr(settings, field, value)
                        try:
                            agent._init_provider()
                        except ProviderError:
                            pass
                        ui.print_error(f"Settings were not applied because the imported provider could not initialize: {error}")
                    else:
                        agent._reset_system_message()
                        settings.save()
                        ui.print_info("Imported settings applied. API keys and local conversations were left unchanged.")
                        agent.logger.event("settings_imported", path=str(source.expanduser()))

    elif name == "/profile":
        choice = rest.strip().lower()
        if not choice:
            ui.print_info(f"Work profile is '{settings.work_profile}'. Use `/profile explore|build|review`.")
        elif choice not in WORK_PROFILES:
            ui.print_error("Usage: /profile <explore|build|review>")
        else:
            profile = WORK_PROFILES[choice]
            settings.work_profile = choice
            settings.budget_profile = profile["budget"]
            settings.max_output_tokens = BUDGET_PROFILES[profile["budget"]]
            settings.execution_mode = profile["mode"]
            settings.save()
            ui.print_info(
                f"Profile '{choice}' enabled: {settings.budget_profile} output budget, {settings.execution_mode} execution mode. "
                "Provider and model were not changed."
            )
            agent.logger.event("work_profile_updated", profile=choice, budget=settings.budget_profile, execution_mode=settings.execution_mode)

    elif name == "/review":
        target = rest.strip() or "."
        prompt = (
            f"Perform a read-only code review of '{target}'. Inspect relevant files without writing, moving, deleting, "
            "or running state-changing commands. Report findings ordered by severity: correctness, security, tests, and "
            "maintainability. For each finding, cite the file and concrete reasoning. If no issue is found, say what you checked."
        )
        ui.print_info("Starting read-only review; no write, delete, move, or shell-execution tools are available for this review.")
        agent.run_turn(prompt, read_only=True)
        _save_session(agent)

    elif name == "/privacy":
        target = rest.strip().lower()
        if not target:
            ui.print_info(
                f"Privacy storage: sessions={sessions.SESSIONS_DIR}, history={HISTORY_PATH}, logs={LOG_DIR}. "
                "Use `/privacy clear logs|sessions|history|all` to delete local records after confirmation."
            )
        elif target.startswith("clear "):
            kind = target[6:].strip()
            if kind not in ("logs", "sessions", "history", "all"):
                ui.print_error("Usage: /privacy clear <logs|sessions|history|all>")
            else:
                try:
                    answer = input(ui.yellow(f"Delete local {kind} data? This cannot be undone. [y/N]: ")).strip().lower()
                except (EOFError, KeyboardInterrupt):
                    answer = ""
                if answer not in ("y", "yes"):
                    ui.print_info("Privacy cleanup cancelled.")
                else:
                    deleted = 0
                    if kind in ("sessions", "all"):
                        deleted += sessions.delete_all()
                    if kind in ("history", "all") and HISTORY_PATH.exists():
                        HISTORY_PATH.unlink()
                        deleted += 1
                    if kind in ("logs", "all") and LOG_DIR.exists():
                        for path in LOG_DIR.glob("*.jsonl"):
                            try:
                                path.unlink()
                                deleted += 1
                            except OSError:
                                pass
                    ui.print_info(f"Privacy cleanup removed {deleted} local item(s).")
                    agent.logger.event("privacy_cleanup", target=kind, removed=deleted)
        else:
            ui.print_error("Usage: /privacy  |  /privacy clear <logs|sessions|history|all>")

    elif name == "/completion":
        shell = rest.strip().lower()
        commands = "--provider --model --budget --output-tokens --approval --context-recovery --ollama-recovery --sandbox --set-key --add-key --prompt --version"
        if shell == "bash":
            print("complete -W '" + commands + "' missdata")
        elif shell == "zsh":
            print("compdef '_arguments \"1: :(" + commands + ")\"' missdata")
        elif shell == "fish":
            for command in commands.split():
                print(f"complete -c missdata -l {command.lstrip('-')}")
        else:
            ui.print_error("Usage: /completion <bash|zsh|fish>")

    elif name == "/sessions":
        rows = sessions.list_sessions()
        if not rows:
            ui.print_info("No saved local sessions yet. Conversations are saved after completed turns.")
        else:
            print(ui.bold("\nSaved sessions:"))
            for row in rows:
                detail = f"({row['provider']}, {row['message_count']} messages)"
                print(f"  {row['id']}  {row['title'][:50]}  {ui.dim(detail)}")
            print(ui.dim("Use `/resume <id>`, `/session-name <name>`, `/new-session`, or `/delete-session <id>`.\n"))
        agent.logger.event("sessions_listed", count=len(rows))

    elif name == "/session-name":
        title = rest.strip()
        if not title:
            ui.print_error("Usage: /session-name <descriptive name>")
        else:
            agent.session_title = title[:120]
            _save_session(agent)
            ui.print_info(f"Session renamed to '{agent.session_title}'.")

    elif name == "/new-session":
        _save_session(agent)
        agent.clear_conversation()
        agent.session_id = sessions.new_session_id()
        agent.session_title = "Untitled session"
        _save_session(agent)
        ui.print_info("Started a new local session; the previous conversation was saved.")

    elif name == "/resume":
        session_id = rest.strip()
        if not session_id:
            ui.print_error("Usage: /resume <session-id>  (see /sessions)")
        else:
            _save_session(agent)
            ok, detail = _resume_session(agent, settings, session_id)
            (ui.print_info if ok else ui.print_error)(detail)

    elif name == "/delete-session":
        session_id = rest.strip()
        if not session_id:
            ui.print_error("Usage: /delete-session <session-id>")
        else:
            try:
                answer = input(ui.yellow(f"Delete saved session {session_id}? This cannot be undone. [y/N]: ")).strip().lower()
            except (EOFError, KeyboardInterrupt):
                answer = ""
            if answer in ("y", "yes"):
                try:
                    deleted = sessions.delete(session_id)
                except ValueError as error:
                    ui.print_error(str(error))
                else:
                    ui.print_info("Saved session deleted." if deleted else "Saved session was not found.")
                    agent.logger.event("session_deleted", deleted_session_id=session_id, deleted=deleted)
            else:
                ui.print_info("Session deletion cancelled.")

    elif name == "/diff":
        ok, text = git_diff(agent.cwd, rest.strip())
        if ok:
            print(ui.bold("\nGit diff:"))
            print(text)
            print()
        else:
            ui.print_error(text)
        agent.logger.event("git_diff_requested", revision=rest.strip(), success=ok)

    elif name == "/checkpoints":
        checkpoints = git_recent_checkpoints(agent.cwd)
        if not checkpoints:
            ui.print_info("No Git checkpoints or commits were found in this working directory.")
        else:
            print(ui.bold("\nRecent checkpoints / commits:"))
            for revision, subject in checkpoints:
                print(f"  {revision}  {subject}")
            print()
        agent.logger.event("git_checkpoints_requested", count=len(checkpoints))

    elif name == "/checkpoint":
        label = rest.strip() or "Miss Data checkpoint"
        try:
            answer = input(ui.yellow("Create a Git checkpoint? This stages and commits all current project changes. [y/N]: ")).strip().lower()
        except (EOFError, KeyboardInterrupt):
            answer = ""
        if answer not in ("y", "yes"):
            ui.print_info("Checkpoint cancelled.")
        else:
            ok, detail = git_checkpoint(agent.cwd, label)
            (ui.print_info if ok else ui.print_error)(detail)
            agent.logger.event("git_checkpoint_created", success=ok, label=label, detail=detail)

    elif name == "/restore":
        revision = rest.strip()
        if not revision:
            ui.print_error("Usage: /restore <checkpoint-revision>  (see /checkpoints)")
        else:
            try:
                answer = input(ui.yellow(f"HARD restore all project files to {revision}? Uncommitted changes will be lost. [y/N]: ")).strip().lower()
            except (EOFError, KeyboardInterrupt):
                answer = ""
            if answer not in ("y", "yes"):
                ui.print_info("Restore cancelled.")
            else:
                ok, detail = git_restore_checkpoint(agent.cwd, revision)
                (ui.print_info if ok else ui.print_error)(detail)
                agent.logger.event("git_restore_requested", success=ok, revision=revision, detail=detail)

    elif name == "/mode":
        choice = rest.strip().lower()
        if not choice:
            ui.print_info(f"Execution mode is '{settings.execution_mode}'. Use `/mode direct|plan`.")
        elif choice not in EXECUTION_MODES:
            ui.print_error("Usage: /mode <direct|plan>")
        else:
            settings.execution_mode = choice
            settings.save()
            ui.print_info("Plan mode will propose a no-tool implementation plan before work." if choice == "plan" else "Direct mode will execute requests immediately.")
            agent.logger.event("execution_mode_updated", mode=choice)

    elif name == "/approve":
        if agent.pending_request is None:
            ui.print_info("There is no pending plan to approve.")
        else:
            request = agent.pending_request
            agent.pending_request = None
            ui.print_info("Plan approved. Executing the original request...")
            agent.logger.event("plan_approved", user_input=request)
            agent.run_turn(request)
            _save_session(agent)

    elif name in ("/reject", "/discard"):
        if agent.discard_pending_request():
            ui.print_info("Pending plan discarded.")
        else:
            ui.print_info("There is no pending plan to discard.")

    elif name == "/map":
        print(ui.bold("\nProject map:"))
        print(project_map(agent.cwd))
        print()
        agent.logger.event("project_map_requested", cwd=agent.cwd)

    elif name == "/test":
        suggestions = discover_tests(agent.cwd)
        if not suggestions:
            ui.print_info("No common test command was detected. You can still ask Miss Data to inspect or run your project tests.")
        elif rest.strip().lower().startswith("run"):
            pieces = rest.strip().split()
            index = 1
            if len(pieces) > 1:
                try:
                    index = int(pieces[1])
                except ValueError:
                    ui.print_error("Usage: /test [run [number]]")
                    return True
            if not 1 <= index <= len(suggestions):
                ui.print_error(f"Choose a test number from 1 to {len(suggestions)}.")
            else:
                command = suggestions[index - 1].command
                ui.print_info(f"Running suggested test #{index}: {command}")
                agent._execute_tool("run_command", json.dumps({"command": command, "timeout": 120}))
        else:
            print(ui.bold("\nSuggested tests:"))
            for index, suggestion in enumerate(suggestions, start=1):
                print(f"  {index}. {suggestion.command}  {ui.dim('— ' + suggestion.reason)}")
            print(ui.dim("Use `/test run <number>` to run one through the normal approval controls.\n"))
        agent.logger.event("test_discovery_requested", count=len(suggestions))

    elif name == "/context":
        chars, tokens = estimate_context(agent.messages)
        ui.print_info(
            f"Conversation estimate: {len(agent.messages)} message(s), about {chars:,} characters / {tokens:,} tokens. "
            "This is an approximation, not a provider billing count. Use `/compact` before long requests if needed."
        )
        agent.logger.event("context_meter_requested", message_count=len(agent.messages), estimated_tokens=tokens)

    elif name == "/status":
        active_keys = len(get_api_keys(settings.provider)) if settings.provider != "ollama" else 0
        key_text = "local provider (no key)" if settings.provider == "ollama" else f"{active_keys} configured key(s)"
        print(ui.bold("\nSession status:"))
        print(f"  Provider: {settings.provider}   Model: {settings.model}")
        print(f"  Budget: {settings.budget_profile} ({settings.max_output_tokens} maximum output tokens per response)")
        print(f"  Credentials: {key_text}")
        print(f"  Working directory: {agent.cwd}")
        print(f"  Safeguards: approval={settings.approval_mode}, sandbox={'on' if settings.sandbox_mode else 'OFF'}")
        print(f"  Recovery: context={settings.context_recovery}, ollama={settings.ollama_recovery}")
        print(f"  Fallback: {' → '.join(settings.fallback_providers) if settings.fallback_providers else 'off'}")
        print(f"  Log: {agent.logger.path}\n")

    elif name == "/changes":
        summary = project_change_summary(agent.cwd)
        print(ui.bold("\nProject changes:"))
        print(format_project_change_summary(summary))
        print()
        agent.logger.event(
            "project_changes_requested", is_repository=summary.is_repository,
            changed_files=summary.changed_files, staged_files=summary.staged_files,
            untracked_files=summary.untracked_files,
        )

    elif name == "/doctor":
        print(ui.bold("\nDiagnostic report:"))
        if settings.provider == "ollama":
            health = ollama_health(settings.ollama_base_url, settings.ollama_model)
            print("  " + health.detail)
            if not health.reachable:
                print("  On your next request, Ollama self-repair can offer to start the local server.")
            elif health.model_available is False:
                print("  On your next request, Ollama self-repair can offer to download the configured model.")
            print(f"  Ollama recovery policy: {settings.ollama_recovery}")
        elif settings.provider == "custom" and not settings.custom_base_url:
            print("  Custom provider needs a base URL. Use `/base-url <https://...>`.")
        elif settings.provider != "ollama" and not get_api_key(settings.provider):
            print(f"  No API key is configured for {settings.provider}. Use `/keys add {settings.provider}`.")
        else:
            print("  Active provider configuration appears complete.")
        print(f"  Budget profile: {settings.budget_profile} ({settings.max_output_tokens} output-token cap)")
        print(f"  Workspace: {agent.cwd}  |  Sandbox: {'on' if settings.sandbox_mode else 'OFF'}")
        print()
        agent.logger.event("doctor_requested", provider=settings.provider)

    elif name == "/budget":
        choice = rest.strip().lower()
        if not choice:
            profiles = ", ".join(f"{name}={limit}" for name, limit in BUDGET_PROFILES.items())
            ui.print_info(
                f"Budget is '{settings.budget_profile}' ({settings.max_output_tokens} max output tokens). "
                f"Profiles: {profiles}. Use `/budget <profile|tokens>`."
            )
        elif choice in BUDGET_PROFILES:
            settings.budget_profile = choice
            settings.max_output_tokens = BUDGET_PROFILES[choice]
            settings.save()
            ui.print_info(f"Budget profile set to '{choice}' ({settings.max_output_tokens} maximum output tokens).")
            agent.logger.event("budget_profile_updated", profile=choice, max_output_tokens=settings.max_output_tokens)
        else:
            try:
                limit = int(choice)
            except ValueError:
                ui.print_error("Usage: /budget <economy|balanced|thorough|128-16384>")
            else:
                if not 128 <= limit <= 16384:
                    ui.print_error("Custom output-token limit must be between 128 and 16384.")
                else:
                    settings.budget_profile = "custom"
                    settings.max_output_tokens = limit
                    settings.save()
                    ui.print_info(f"Custom output cap set to {limit} tokens per response.")
                    agent.logger.event("budget_profile_updated", profile="custom", max_output_tokens=limit)

    elif name == "/clear":
        agent.clear_conversation()
        ui.print_info("Conversation cleared.")

    elif name == "/compact":
        keep = 0
        if rest.strip():
            try:
                keep = int(rest.strip())
            except ValueError:
                ui.print_error("Usage: /compact [n]  (n = recent turns to keep verbatim, default 0)")
                return True
        ui.print_info("Compacting conversation — summarizing older turns in one model call...")
        try:
            stats = agent.compact_context(keep_recent_turns=keep)
        except ValueError as e:
            ui.print_error(str(e))
        except ProviderError as e:
            ui.print_error(str(e))
        else:
            print()
            ui.print_info(
                f"Compacted: {stats['before']} messages → {stats['after']} "
                f"(kept {stats['kept_turns']} recent turn(s) verbatim)."
            )

    elif name == "/memory":
        print(ui.bold("\nRemembered facts:"))
        mem = memory.load_memory()
        if not mem["facts"]:
            print(ui.dim("  (none yet)"))
        for i, f in enumerate(mem["facts"]):
            text = f["text"] if isinstance(f, dict) else f
            print(f"  {i}. {text}")
        print()

    elif name == "/forget":
        try:
            idx = int(rest.strip())
        except ValueError:
            ui.print_error("Usage: /forget <number> (see /memory for numbers)")
        else:
            if memory.remove_fact(idx):
                ui.print_info(f"Forgot fact #{idx}.")
                agent._reset_system_message()
            else:
                ui.print_error(f"No fact #{idx}.")

    elif name == "/cwd":
        if not rest.strip():
            print(agent.cwd)
        else:
            try:
                new_cwd = agent.change_cwd(rest.strip())
                ui.print_info(f"Working directory: {new_cwd}")
            except FileNotFoundError as e:
                ui.print_error(str(e))

    elif name in ("/log", "/logs"):
        ui.print_info(f"Current session log: {agent.logger.path}")
        ui.print_info("Logs are newline-delimited JSON and remain available after exit.")
        agent.logger.event("log_path_requested", log_file=str(agent.logger.path))

    elif name == "/keys":
        tokens = rest.strip().split()
        if not tokens:
            print(ui.bold("\nConfigured API-key pools:"))
            for provider in PROVIDERS:
                if provider == "ollama":
                    print(f"  {provider}: local server (no API key)")
                else:
                    print(f"  {provider}: {len(get_api_keys(provider))} key(s)")
            print(ui.dim("Use `/keys show <provider>` for masked values, `/keys add`, `/keys edit`, `/keys remove`, or `/keys replace`.\n"))
        elif len(tokens) >= 2 and tokens[1].lower() in PROVIDERS:
            operation, provider = tokens[0].lower(), tokens[1].lower()
            if provider == "ollama":
                ui.print_info("Ollama is a local provider and does not use API keys.")
            elif operation == "add" and len(tokens) == 2:
                _prompt_for_key(provider, append=True, logger=agent.logger)
                _refresh_active_credentials(agent, provider)
            elif operation == "replace" and len(tokens) == 2:
                _prompt_for_key(provider, append=False, logger=agent.logger)
                _refresh_active_credentials(agent, provider)
            elif operation == "show" and len(tokens) in (2, 3):
                reveal = len(tokens) == 3 and tokens[2].lower() == "reveal"
                if len(tokens) == 3 and not reveal:
                    ui.print_error("Usage: /keys show <provider> [reveal]")
                else:
                    keys = get_api_keys(provider)
                    if not keys:
                        ui.print_info(f"No API keys configured for {provider}.")
                    elif reveal:
                        try:
                            answer = input(ui.yellow("Full keys will be printed to this terminal. Reveal them? [y/N]: ")).strip().lower()
                        except (EOFError, KeyboardInterrupt):
                            answer = ""
                        if answer in ("y", "yes"):
                            print(ui.bold(f"\n{provider} API keys (sensitive):"))
                            for index, key in enumerate(keys, start=1):
                                print(f"  {index}. {key}")
                            print()
                            agent.logger.event("api_keys_revealed", provider=provider, count=len(keys))
                        else:
                            ui.print_info("Keys were not revealed.")
                    else:
                        print(ui.bold(f"\n{provider} API keys (masked):"))
                        for index, key in enumerate(keys, start=1):
                            print(f"  {index}. {_masked_key(key)}")
                        print(ui.dim("Use `/keys show " + provider + " reveal` only when it is safe to print the full values.\n"))
                        agent.logger.event("api_keys_viewed_masked", provider=provider, count=len(keys))
            elif operation in ("edit", "remove") and len(tokens) == 3:
                try:
                    position = int(tokens[2])
                except ValueError:
                    ui.print_error(f"Key position must be a number. Use `/keys show {provider}` first.")
                    return True
                keys = get_api_keys(provider)
                if not 1 <= position <= len(keys):
                    ui.print_error(f"No key #{position} for {provider}. Use `/keys show {provider}` first.")
                elif operation == "edit":
                    replacement = _read_key_replacement(provider, position)
                    if replacement is None:
                        ui.print_info("Key edit cancelled.")
                    else:
                        keys[position - 1] = replacement
                        save_api_keys(provider, keys)
                        agent.logger.event("api_key_edited", provider=provider, position=position)
                        ui.print_info(f"Updated {provider} key #{position}.")
                        _refresh_active_credentials(agent, provider)
                else:
                    try:
                        answer = input(ui.yellow(f"Remove {provider} key #{position}? [y/N]: ")).strip().lower()
                    except (EOFError, KeyboardInterrupt):
                        answer = ""
                    if answer not in ("y", "yes"):
                        ui.print_info("Key removal cancelled.")
                    else:
                        remaining = keys[:position - 1] + keys[position:]
                        if remaining:
                            save_api_keys(provider, remaining)
                        else:
                            delete_api_keys(provider)
                        agent.logger.event("api_key_removed", provider=provider, position=position, remaining=len(remaining))
                        ui.print_info(f"Removed {provider} key #{position}.")
                        _refresh_active_credentials(agent, provider)
            else:
                ui.print_error("Usage: /keys | /keys show <provider> [reveal] | /keys add|replace <provider> | /keys edit|remove <provider> <number>")
        else:
            ui.print_error("Usage: /keys | /keys show <provider> [reveal] | /keys add|replace <provider> | /keys edit|remove <provider> <number>")

    elif name == "/ollama-recovery":
        choice = rest.strip().lower()
        if not choice:
            ui.print_info(
                f"Ollama self-repair is '{settings.ollama_recovery}'. "
                "Use `/ollama-recovery ask|auto|off`."
            )
        elif choice not in OLLAMA_RECOVERY_MODES:
            ui.print_error("Usage: /ollama-recovery <ask|auto|off>")
        else:
            settings.ollama_recovery = choice
            settings.save()
            if choice == "auto":
                ui.print_info("Miss Data may start local Ollama or pull the selected model, then retry once.")
            elif choice == "ask":
                ui.print_info("Miss Data will ask before starting local Ollama or downloading a model.")
            else:
                ui.print_info("Ollama self-repair disabled.")
            agent.logger.event("ollama_recovery_mode_updated", mode=choice)

    elif name == "/context-recovery":
        choice = rest.strip().lower()
        if not choice:
            ui.print_info(
                f"Context-limit recovery is '{settings.context_recovery}'. "
                "Use `/context-recovery ask|auto|off`."
            )
        elif choice not in CONTEXT_RECOVERY_MODES:
            ui.print_error("Usage: /context-recovery <ask|auto|off>")
        else:
            settings.context_recovery = choice
            settings.save()
            if choice == "auto":
                ui.print_info("Oversized conversations will compact and retry automatically once before failover.")
            elif choice == "ask":
                ui.print_info("Miss Data will ask before compacting an oversized conversation.")
            else:
                ui.print_info("Automatic context recovery disabled.")
            agent.logger.event("context_recovery_mode_updated", mode=choice)

    elif name == "/fallback":
        value = rest.strip()
        if not value:
            enabled = settings.fallback_providers
            if enabled:
                ui.print_info("Fallback offer order: " + " → ".join(enabled))
            else:
                ui.print_info("Cross-provider fallback is disabled; key rotation remains enabled.")
            ui.print_info("Use `/fallback set groq,openai,anthropic` or `/fallback off`.")
        elif value.lower() == "off":
            settings.fallback_providers = []
            settings.save()
            ui.print_info("Cross-provider fallback disabled. Multiple keys for the active provider still rotate automatically.")
            agent.logger.event("fallback_order_updated", providers=[])
        elif value.lower().startswith("set "):
            requested = [item.strip().lower() for item in value[4:].replace(",", " ").split() if item.strip()]
            invalid = [provider for provider in requested if provider not in PROVIDERS]
            if invalid or not requested:
                ui.print_error(f"Fallback providers must be valid names: {'|'.join(PROVIDERS)}")
            else:
                settings.fallback_providers = list(dict.fromkeys(requested))
                settings.save()
                ui.print_info("Fallback offer order set to: " + " → ".join(settings.fallback_providers))
                agent.logger.event("fallback_order_updated", providers=settings.fallback_providers)
        else:
            ui.print_error("Usage: /fallback  |  /fallback set <provider,...>  |  /fallback off")

    elif name == "/provider":
        choice = rest.strip().lower()
        if choice not in PROVIDERS:
            ui.print_error(f"Usage: /provider <{'|'.join(PROVIDERS)}>")
        elif choice == "custom" and not settings.custom_base_url:
            ui.print_error(
                "Set a base URL first with `/base-url <https://...>`, then switch to 'custom'."
            )
        else:
            if choice != "ollama" and not get_api_key(choice):
                _prompt_for_key(choice)
            if choice == "ollama" or get_api_key(choice):
                try:
                    agent.switch_provider(choice)
                except ProviderError as e:
                    ui.print_error(str(e))
                else:
                    ui.print_info(f"Switched to {choice} ({settings.model}). Conversation history was reset (memory facts are kept).")
            else:
                ui.print_error(f"No API key set for {choice}; staying on {settings.provider}.")

    elif name == "/ollama-url":
        if not rest.strip():
            print(settings.ollama_base_url)
        else:
            settings.ollama_base_url = rest.strip().rstrip("/")
            settings.save()
            if settings.provider == "ollama":
                agent._init_provider()
            ui.print_info(f"Ollama base URL set to {settings.ollama_base_url}.")

    elif name == "/base-url":
        if not rest.strip():
            print(settings.custom_base_url or "(not set)")
        else:
            settings.custom_base_url = rest.strip().rstrip("/")
            settings.save()
            if settings.provider == "custom":
                agent._init_provider()
            ui.print_info(f"Custom endpoint base URL set to {settings.custom_base_url}.")

    elif name == "/api-key-env":
        if not rest.strip():
            print(settings.custom_api_key_env)
        else:
            settings.custom_api_key_env = rest.strip()
            settings.save()
            ui.print_info(
                f"Custom provider will now read its API key from ${settings.custom_api_key_env}. "
                f"Set it with `missdata --set-key custom`."
            )

    elif name == "/gpu-layers":
        if not rest.strip():
            print(settings.ollama_num_gpu if settings.ollama_num_gpu is not None else "auto")
        elif rest.strip().lower() == "auto":
            settings.ollama_num_gpu = None
            settings.save()
            ui.print_info("Ollama GPU layers set back to auto.")
        else:
            try:
                settings.ollama_num_gpu = int(rest.strip())
            except ValueError:
                ui.print_error("Usage: /gpu-layers <n>|auto")
            else:
                settings.save()
                ui.print_info(
                    f"Ollama will try to force {settings.ollama_num_gpu} layers onto GPU. "
                    f"Too high can OOM the GPU process — lower it if generation errors out."
                )

    elif name == "/model":
        if not rest.strip():
            print(settings.model)
        else:
            settings.model = rest.strip()
            settings.save()
            agent._init_provider()
            ui.print_info(f"Model set to {settings.model} for provider {settings.provider}.")

    elif name == "/approval":
        choice = rest.strip().lower()
        if choice not in APPROVAL_MODES:
            ui.print_error(f"Usage: /approval <{'|'.join(APPROVAL_MODES)}>")
        else:
            settings.approval_mode = choice
            settings.save()
            ui.print_info(f"Approval mode set to '{choice}'.")

    elif name == "/sandbox":
        choice = rest.strip().lower()
        if choice not in ("on", "off"):
            print(f"Sandbox is currently {'on' if settings.sandbox_mode else 'OFF'}.")
            ui.print_error("Usage: /sandbox <on|off>")
        else:
            settings.sandbox_mode = (choice == "on")
            settings.save()
            if settings.sandbox_mode:
                ui.print_info(f"Sandbox on: file tools confined to {agent.sandbox_root}, dangerous commands blocked.")
            else:
                ui.print_info("Sandbox OFF: file tools and shell commands now have unrestricted access. Use with care.")

    elif name == "/lang":
        choice = rest.strip().lower()
        if choice not in ("en", "fa"):
            ui.print_error("Usage: /lang <en|fa>")
        else:
            settings.language = choice
            settings.save()
            agent._reset_system_message()
            ui.print_info(f"Language set to '{choice}'.")

    else:
        ui.print_error(f"Unknown command: {name}. Type /help for a list.")

    return True


def repl(settings: Settings, cwd: str | None) -> None:
    if not ensure_api_key(settings):
        ui.print_error("Cannot start without an API key.")
        sys.exit(1)

    try:
        agent = Agent(settings, cwd=cwd)
    except Exception as e:  # noqa: BLE001
        ui.print_error(f"Failed to start: {e}")
        sys.exit(1)

    terminal_input = TerminalInput(HISTORY_PATH)
    enhanced_input = terminal_input.setup()
    ui.print_banner(
        settings.provider, settings.model, agent.cwd, sandbox_mode=settings.sandbox_mode,
        budget_profile=settings.budget_profile, max_output_tokens=settings.max_output_tokens,
    )
    ui.print_info(f"Session activity log: {agent.logger.path}  (use /logs anytime)")
    if enhanced_input:
        ui.print_info("Line editing and persistent history enabled. Use arrows/backspace normally; press Ctrl+C while a response is generating to stop it safely.")
    else:
        ui.print_info("Standard terminal input in use. Install project dependencies for enhanced line editing and history.")

    try:
        while True:
            try:
                user_input = terminal_input.prompt(ui.print_user_prompt_marker())
            except (EOFError, KeyboardInterrupt):
                print()
                break

            stripped = user_input.strip()
            if not stripped:
                continue

            if stripped.startswith("/"):
                should_continue = handle_slash_command(stripped, agent, settings)
                if not should_continue:
                    break
                continue

            if settings.execution_mode == "plan":
                agent.propose_plan(user_input)
            else:
                agent.run_turn(user_input)
            _save_session(agent)
    finally:
        terminal_input.close()



def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="missdata",
        description="Miss Data (خانم داده) — a terminal coding agent.",
    )
    parser.add_argument("--dir", "-C", help="Working directory to start in (default: current directory)")
    parser.add_argument("--provider", choices=PROVIDERS, help="LLM provider to use for this session")
    parser.add_argument("--model", help="Model name override for this session")
    parser.add_argument("--base-url", help="API base URL for --provider custom (e.g. https://api.example.com/v1)")
    parser.add_argument("--approval", choices=APPROVAL_MODES, help="Approval mode for this session")
    parser.add_argument("--budget", choices=tuple(BUDGET_PROFILES),
                        help="Budget profile that caps generated output: economy, balanced, or thorough")
    parser.add_argument("--output-tokens", type=int, metavar="N",
                        help="Custom maximum output tokens per response (128-16384); overrides --budget")
    parser.add_argument("--context-recovery", choices=CONTEXT_RECOVERY_MODES,
                        help="On oversized requests: ask before compacting, compact automatically, or turn recovery off")
    parser.add_argument("--ollama-recovery", choices=OLLAMA_RECOVERY_MODES,
                        help="On local Ollama failures: ask before repair, repair automatically, or turn repair off")
    parser.add_argument("--sandbox", choices=("on", "off"),
                         help="Confine file tools to the working directory and block dangerous "
                              "commands (default: on). Use 'off' to restore full, unrestricted "
                              "local-dev-tool behavior.")
    parser.add_argument("--set-key", choices=PROVIDERS, metavar="PROVIDER",
                        help="Replace a provider's key pool with one or more API keys, then exit")
    parser.add_argument("--add-key", choices=PROVIDERS, metavar="PROVIDER",
                        help="Append one or more keys to a provider's existing key pool, then exit")

    parser.add_argument("--prompt", "-p", help="Run a single prompt non-interactively and exit")
    parser.add_argument("--version", action="store_true", help="Print version and exit")

    args = parser.parse_args(argv)

    ensure_dirs()
    load_env()
    settings = Settings.load()

    if args.version:
        from . import __version__
        print(f"missdata {__version__}")
        return

    if args.set_key:
        logger = ActivityLogger()
        logger.event("api_key_pool_prompted", provider=args.set_key, operation="replace")
        _prompt_for_key(args.set_key, logger=logger)
        logger.close()
        return
    if args.add_key:
        logger = ActivityLogger()
        logger.event("api_key_pool_prompted", provider=args.add_key, operation="append")
        _prompt_for_key(args.add_key, append=True, logger=logger)
        logger.close()
        return

    if args.provider:
        settings.provider = args.provider
    if args.model:
        settings.model = args.model
    if args.base_url:
        settings.custom_base_url = args.base_url.rstrip("/")
    if args.approval:
        settings.approval_mode = args.approval
    if args.budget:
        settings.budget_profile = args.budget
        settings.max_output_tokens = BUDGET_PROFILES[args.budget]
    if args.output_tokens is not None:
        if not 128 <= args.output_tokens <= 16384:
            parser.error("--output-tokens must be between 128 and 16384")
        settings.budget_profile = "custom"
        settings.max_output_tokens = args.output_tokens
    if args.context_recovery:
        settings.context_recovery = args.context_recovery
    if args.ollama_recovery:
        settings.ollama_recovery = args.ollama_recovery
    if args.sandbox:
        settings.sandbox_mode = (args.sandbox == "on")

    if args.prompt:
        if not ensure_api_key(settings):
            ui.print_error("Cannot run without an API key.")
            sys.exit(1)
        # --prompt promises non-interactive behavior. Provider changes are
        # therefore not performed here because every cross-company switch
        # requires explicit approval from an interactive user.
        agent = Agent(settings, cwd=args.dir, allow_provider_switch_prompt=False)
        agent.run_turn(args.prompt)
        return

    repl(settings, cwd=args.dir)


if __name__ == "__main__":
    main()
