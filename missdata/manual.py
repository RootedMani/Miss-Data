"""Concise in-program manual and capability card for Miss Data."""
from __future__ import annotations

import textwrap
from dataclasses import dataclass


@dataclass(frozen=True)
class ManualPage:
    name: str
    synopsis: str
    description: str
    examples: tuple[str, ...] = ()
    safety: str = ""
    aliases: tuple[str, ...] = ()


PAGES: dict[str, ManualPage] = {
    "overview": ManualPage(
        "missdata", "missdata  [options]", "Miss Data is a terminal coding assistant. Type a request in plain language, or use slash commands for local workflows. Start with `/status`, `/map`, or `/man getting-started`.",
        ("/man workflows", "/help", "/status"),
    ),
    "getting-started": ManualPage(
        "getting-started", "Type a request, then review the answer and file summary.",
        "Choose a working directory, confirm the provider/model in the banner, and ask a focused request. Use `/mode plan` when you want an implementation plan before tools can act. Use `/map` before working in an unfamiliar repository.",
        ("/map", "/mode plan", "Add tests for the parser and run the suggested test command."),
        aliases=("start", "begin", "basics"),
    ),
    "commands": ManualPage(
        "commands", "/help [topic]  |  /man [topic]  |  /man search <words>",
        "`/help` is a compact command index. `/help <topic>` and `/man <topic>` open a focused guide. Use `/man search backup` to find related pages. Important topic names: getting-started, providers, keys, resilience, workflows, sessions, safety, privacy, update, and troubleshooting.",
        ("/man keys", "/man search ollama", "/help workflows"),
        aliases=("help", "manual"),
    ),
    "providers": ManualPage(
        "providers", "/provider <name>  |  /model <name>  |  /profile <name>",
        "Switch among configured remote providers and local Ollama. Provider switches reset the conversation because provider message formats differ. `/profile explore|build|review` adjusts output budget and plan/direct behavior but never silently changes provider or account.",
        ("/provider ollama", "/model llama3.2", "/profile explore"),
        safety="Changing company/provider is always explicit. Configure a provider key before requesting it.",
        aliases=("model", "budget", "profile"),
    ),
    "keys": ManualPage(
        "keys", "/keys [show|add|replace|edit|remove] <provider>",
        "Manage ordered API-key pools. Failed or limited keys can rotate automatically. Default key display is masked; reveal requires another confirmation. Active-provider key edits refresh immediately.",
        ("/keys show groq", "/keys add groq", "/keys edit groq 2", "/keys remove groq 1"),
        safety="Full-key display can expose credentials in terminal scrollback. Key values are never written to activity logs.",
        aliases=("api", "api-key", "credentials", "fallback"),
    ),
    "resilience": ManualPage(
        "resilience", "/fallback  |  /context-recovery <ask|auto|off>  |  /ollama-recovery <ask|auto|off>",
        "Miss Data rotates same-provider keys before offering another configured provider. Context-limit errors can compact older history and retry. Local Ollama connection or missing-model failures can start a local server or pull the configured model after permission.",
        ("/fallback set groq,ollama", "/context-recovery auto", "/ollama-recovery ask"),
        safety="Cross-provider changes ask first. Ollama repair only targets loopback endpoints and does not use a shell.",
        aliases=("rate-limit", "compact", "ollama", "errors"),
    ),
    "workflows": ManualPage(
        "workflows", "/map  |  /test [run N]  |  /context  |  /mode plan  |  /review [path]", 
        "Use no-model-cost local commands to orient yourself before spending tokens. `/map` detects project structure and likely tests. `/test` suggests commands; running one goes through approvals. `/review` is model-backed but restricts tools to read-only inspection.",
        ("/map", "/test", "/test run 1", "/review src"),
        aliases=("map", "test", "review", "plan"),
    ),
    "git": ManualPage(
        "git", "/diff [revision]  |  /checkpoint [name]  |  /checkpoints  |  /restore <revision>",
        "Inspect a bounded diff, create a local checkpoint commit, list recent revisions, or restore a selected revision. These commands work only inside a Git repository.",
        ("/diff", "/checkpoint before-refactor", "/checkpoints", "/restore a1b2c3d"),
        safety="Checkpoint stages all project changes. Restore performs a hard reset and can discard uncommitted work; both require confirmation.",
        aliases=("diff", "checkpoint", "rollback", "restore"),
    ),
    "sessions": ManualPage(
        "sessions", "/sessions  |  /resume <id>  |  /new-session  |  /session-name <name>",
        "Completed conversations are stored locally for resume. List IDs, name the current session, start a new saved session, resume a prior conversation, or delete one selected session.",
        ("/sessions", "/session-name parser cleanup", "/resume 12ab34cd56ef"),
        safety="Session files contain conversation messages. Use `/privacy` to locate or delete them.",
        aliases=("resume", "history", "conversation"),
    ),
    "safety": ManualPage(
        "safety", "/approval <always|risky|auto>  |  /sandbox <on|off>  |  Ctrl+C", 
        "Approval policy controls when tool actions ask first. Sandbox confines file work to the selected working directory and blocks a focused set of destructive commands. Press Ctrl+C during generation to safely stop an incomplete model turn.",
        ("/approval risky", "/sandbox on", "/cwd ./my-project"),
        safety="Sandbox is a helpful local boundary, not a substitute for reviewing risky actions. Ctrl+C does not roll back a tool that already completed.",
        aliases=("approval", "sandbox", "cancel", "stop"),
    ),
    "privacy": ManualPage(
        "privacy", "/logs  |  /privacy  |  /privacy clear <logs|sessions|history|all>",
        "Activity logs record redacted events. Prompt history and resumable sessions stay local. View storage locations or remove selected local records after confirmation.",
        ("/logs", "/privacy", "/privacy clear sessions"),
        aliases=("logs", "data", "delete-data"),
    ),
    "update": ManualPage(
        "update", "/update [check|apply]", 
        "Check the trusted Miss Data source checkout for updates. Apply fast-forwards only from the official configured repository and only when the source worktree is clean. A natural-language request to update also checks first and asks before applying.",
        ("/update", "/update apply"),
        safety="Updates reject arbitrary remotes, dirty source trees, detached checkouts, merges, and automatic dependency installation.",
        aliases=("self-update", "upgrade"),
    ),
    "backup": ManualPage(
        "backup", "/export-config [path]  |  /import-config <path>",
        "Export portable settings and import them on another machine. Backups contain preferences only: API keys, logs, prompt history, and sessions are excluded.",
        ("/export-config ~/missdata-settings.json", "/import-config ~/missdata-settings.json"),
        aliases=("export", "import", "config"),
    ),
    "troubleshooting": ManualPage(
        "troubleshooting", "/status  |  /doctor  |  /changes  |  /logs", 
        "Start with `/status` to inspect provider, model, budgets, safeguards, recovery, and log location. Use `/doctor` for no-model-cost local diagnostics and `/changes` for a Git summary. For request-size errors, use `/context` or `/compact`.",
        ("/status", "/doctor", "/context", "/logs"),
        aliases=("doctor", "debug", "error"),
    ),
}


def normalize_topic(topic: str) -> str:
    return topic.strip().lower().lstrip("/").replace("_", "-")


def lookup(topic: str) -> ManualPage | None:
    key = normalize_topic(topic)
    if key in PAGES:
        return PAGES[key]
    for page in PAGES.values():
        if key in page.aliases:
            return page
    return None


def search(query: str) -> list[ManualPage]:
    terms = [term for term in normalize_topic(query).split() if term]
    if not terms:
        return list(PAGES.values())
    scored: list[tuple[int, ManualPage]] = []
    for page in PAGES.values():
        corpus = " ".join((page.name, page.synopsis, page.description, " ".join(page.aliases))).lower()
        score = sum(term in corpus for term in terms)
        if score:
            scored.append((score, page))
    return [page for _, page in sorted(scored, key=lambda item: (-item[0], item[1].name))]


def render(page: ManualPage, width: int = 88) -> str:
    lines = [page.name.upper(), "", "SYNOPSIS", "  " + page.synopsis, "", "DESCRIPTION"]
    lines.extend(textwrap.wrap(page.description, width=width, initial_indent="  ", subsequent_indent="  "))
    if page.examples:
        lines.extend(("", "EXAMPLES"))
        lines.extend("  " + example for example in page.examples)
    if page.safety:
        lines.extend(("", "SAFETY NOTE"))
        lines.extend(textwrap.wrap(page.safety, width=width, initial_indent="  ", subsequent_indent="  "))
    lines.extend(("", "SEE ALSO", "  /man commands   /man getting-started   /man troubleshooting"))
    return "\n".join(lines)


def index_text() -> str:
    names = ", ".join(sorted(PAGES))
    return "Manual topics:\n  " + names + "\n\nUse `/man <topic>` or `/man search <words>`."


def capability_reference() -> str:
    """Compact, generated source of truth embedded into the model system prompt."""
    lines = ["## Miss Data capability reference", "When users ask how to use Miss Data, answer from this reference and offer the exact command. Do not invent commands or claim unsupported integrations."]
    for key in ("getting-started", "providers", "keys", "resilience", "workflows", "git", "sessions", "safety", "privacy", "update", "backup", "troubleshooting"):
        page = PAGES[key]
        lines.append(f"- **{page.name}:** `{page.synopsis}` — {page.description}")
    lines.append("For expanded local documentation, direct users to `/man <topic>`, `/man search <words>`, or `/help <topic>`. Mention relevant safety notes before destructive, credential, privacy, or update actions.")
    return "\n".join(lines)
