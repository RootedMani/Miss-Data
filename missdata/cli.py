"""
Miss Data CLI entry point.
"""

from __future__ import annotations

import argparse
import os
import sys

from . import memory, ui
from .activity import ActivityLogger
from .agent import Agent
from .config import (
    APPROVAL_MODES, CONTEXT_RECOVERY_MODES, OPENAI_COMPATIBLE_PRESETS, PROVIDERS, Settings, ensure_dirs,
    get_api_key, get_api_keys, load_env, save_api_keys,
)
from .providers import ProviderError


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
            key = input(f"Paste a {label} API key (or press Enter to finish): ").strip()
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
        ui.print_help()

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
            print(ui.dim("Use `/keys add <provider>` to append keys without revealing existing values.\n"))
        elif len(tokens) == 2 and tokens[0].lower() == "add" and tokens[1].lower() in PROVIDERS:
            _prompt_for_key(tokens[1].lower(), append=True)
            agent.logger.event("api_key_pool_updated", provider=tokens[1].lower(), count=len(get_api_keys(tokens[1].lower())))
        else:
            ui.print_error("Usage: /keys  or  /keys add <provider>")

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

    ui.print_banner(settings.provider, settings.model, agent.cwd, sandbox_mode=settings.sandbox_mode)
    ui.print_info(f"Session activity log: {agent.logger.path}  (use /logs anytime)")

    while True:
        try:
            user_input = input(ui.print_user_prompt_marker())
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

        agent.run_turn(user_input)


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
    parser.add_argument("--context-recovery", choices=CONTEXT_RECOVERY_MODES,
                        help="On oversized requests: ask before compacting, compact automatically, or turn recovery off")
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
    if args.context_recovery:
        settings.context_recovery = args.context_recovery
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
