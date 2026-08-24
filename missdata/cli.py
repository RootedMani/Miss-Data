"""
Miss Data CLI entry point.
"""

from __future__ import annotations

import argparse
import os
import sys

from . import memory, ui
from .agent import Agent
from .config import (
    APPROVAL_MODES, PROVIDERS, Settings, ensure_dirs, get_api_key,
    load_env, save_api_key,
)


def _prompt_for_key(provider: str) -> None:
    if provider == "ollama":
        return  # local server, no API key involved
    label = "Groq" if provider == "groq" else "Anthropic"
    env_var = "GROQ_API_KEY" if provider == "groq" else "ANTHROPIC_API_KEY"
    print(ui.yellow(f"\nNo {label} API key found ({env_var})."))
    url = "https://console.groq.com/keys" if provider == "groq" else "https://console.anthropic.com/settings/keys"
    print(ui.dim(f"Get one at: {url}"))
    try:
        key = input(f"Paste your {label} API key (or press Enter to skip): ").strip()
    except (EOFError, KeyboardInterrupt):
        key = ""
    if key:
        save_api_key(provider, key)
        print(ui.green("Saved.\n"))
    else:
        print(ui.dim("Skipped — set it later with `missdata --set-key " + provider + "`.\n"))


def ensure_api_key(settings: Settings) -> bool:
    if settings.provider == "ollama":
        return True  # nothing to check locally
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

    if name in ("/exit", "/quit"):
        return False

    if name == "/help":
        ui.print_help()

    elif name == "/clear":
        agent.clear_conversation()
        ui.print_info("Conversation cleared.")

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

    elif name == "/provider":
        choice = rest.strip().lower()
        if choice not in PROVIDERS:
            ui.print_error(f"Usage: /provider <{'|'.join(PROVIDERS)}>")
        else:
            if choice != "ollama" and not get_api_key(choice):
                _prompt_for_key(choice)
            if choice == "ollama" or get_api_key(choice):
                agent.switch_provider(choice)
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
    parser.add_argument("--approval", choices=APPROVAL_MODES, help="Approval mode for this session")
    parser.add_argument("--sandbox", choices=("on", "off"),
                         help="Confine file tools to the working directory and block dangerous "
                              "commands (default: on). Use 'off' to restore full, unrestricted "
                              "local-dev-tool behavior.")
    parser.add_argument("--set-key", choices=PROVIDERS, metavar="PROVIDER",
                         help="Prompt for and save an API key for a provider, then exit")
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
        _prompt_for_key(args.set_key)
        return

    if args.provider:
        settings.provider = args.provider
    if args.model:
        settings.model = args.model
    if args.approval:
        settings.approval_mode = args.approval
    if args.sandbox:
        settings.sandbox_mode = (args.sandbox == "on")

    if args.prompt:
        if not ensure_api_key(settings):
            ui.print_error("Cannot run without an API key.")
            sys.exit(1)
        agent = Agent(settings, cwd=args.dir)
        agent.run_turn(args.prompt)
        return

    repl(settings, cwd=args.dir)


if __name__ == "__main__":
    main()
