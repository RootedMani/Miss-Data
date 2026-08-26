# Miss Data: Complete Project Documentation

**Miss Data** is a terminal-based coding agent. It combines a conversational language-model interface with controlled local tools for inspecting files, editing code, running commands, searching the web, and retaining selected user preferences. The program supports Groq, Anthropic, Ollama, several OpenAI-compatible providers, and a configurable custom OpenAI-compatible endpoint.

> **Operating principle.** The application separates model-provider communication from local tools. A provider supplies reasoning and tool calls; the agent validates and executes allowed local actions subject to sandbox and approval settings.

## 1. Quick start

Create and activate a Python virtual environment, install the project, configure at least one model provider, and start the command-line interface.

```bash
python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
pip install -e .
missdata
```

| Goal | Command |
|---|---|
| Start in the current directory | `missdata` |
| Start in another directory | `missdata --dir /path/to/project` |
| Use a selected provider temporarily | `missdata --provider ollama` |
| Run one non-interactive prompt | `missdata -p "summarize this repository"` |
| Save or replace a provider key pool | `missdata --set-key groq` |
| Append a provider key | `missdata --add-key groq` |
| Start an economical output-capped session | `missdata --budget economy` |
| Set a custom response cap | `missdata --output-tokens 1024` |

On the first interactive run, Miss Data asks for a key for the active provider when necessary. It stores configuration outside the project directory, which avoids accidental commits of credentials.

## 2. Installation and launch paths

The repository contains `setup.sh` and `setup.bat` for platform-oriented setup, `run.py` for launching without installing a package command, and `pyproject.toml` for standard Python packaging. The required runtime packages are listed in `requirements.txt`.

| File | Purpose |
|---|---|
| `run.py` | Simple direct launcher for the CLI module. |
| `setup.sh` | Shell-based setup helper for Unix-like environments. |
| `setup.bat` | Batch-file setup helper for Windows. |
| `pyproject.toml` | Package metadata and the `missdata` console-script entry point. |
| `requirements.txt` | Runtime dependency list. |
| `.env.example` | Credential and key-pool configuration template. |

The CLI accepts configuration flags before a session begins. Settings provided on the command line apply to that process. Persistent slash-command settings are written to the user settings file.

```bash
missdata --provider groq --model openai/gpt-oss-120b
missdata --provider ollama --model gemma4:e4b --ollama-recovery ask
missdata --provider openai --context-recovery auto
```

## 3. Architecture

The application is organized around a small set of responsibilities. The `Agent` holds the conversation and executes the turn loop. Provider classes translate that conversation to individual service APIs. Tool implementations perform local work, while configuration, memory, sandboxing, user-interface helpers, logging, and recovery routines remain separate.

| Module | Responsibility |
|---|---|
| `missdata/cli.py` | Argument parsing, first-run credential prompts, REPL, and slash commands. |
| `missdata/agent.py` | Conversation state, tool loop, approvals, provider retry/failover, context recovery, and Ollama recovery orchestration. |
| `missdata/providers.py` | Groq, Anthropic, Ollama, and OpenAI-compatible request/stream adapters. |
| `missdata/config.py` | Cross-platform configuration paths, saved settings, provider presets, and API-key pools. |
| `missdata/tools.py` | Tool schemas, command descriptions, implementation registry, and local actions. |
| `missdata/sandbox.py` | Working-directory confinement, command safety checks, and resource-limit helpers. |
| `missdata/memory.py` | Persistent remembered facts. |
| `missdata/activity.py` | Redacted JSONL session logging. |
| `missdata/ollama_recovery.py` | Local-only Ollama diagnosis, server start, and model-pull repair helpers. |
| `missdata/insights.py` | No-model-cost Git worktree summaries and local Ollama health checks. |
| `missdata/ui.py` | Terminal formatting, status output, help, prompts, and spinner. |
| `missdata/system_prompt.md` | Model instructions, available-tool guidance, and response behavior. |

A normal turn follows this sequence: the user sends a message, the agent asks the active provider for a streamed result, the provider may return text or tool calls, the agent requests approval for actions where policy requires it, tool results are appended to the conversation, and the provider is called again until it returns a final answer.

## 4. Providers and models

The provider layer normalizes different APIs behind one interface. You may select a provider with `--provider <name>` at launch or `/provider <name>` during an interactive session. Switching provider intentionally resets the active conversation because native tool-call formats differ by API; remembered facts remain available.

| Provider type | Provider names | Credential behavior |
|---|---|---|
| Groq | `groq` | `GROQ_API_KEY` or ordered `GROQ_API_KEYS`. |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` or ordered `ANTHROPIC_API_KEYS`. |
| Local Ollama | `ollama` | No API key; connects to `OLLAMA` server URL setting. |
| OpenAI-compatible presets | `openai`, `deepseek`, `openrouter`, `together`, `mistral`, `fireworks`, `xai`, `moonshot`, `perplexity` | Each uses its documented environment-variable prefix and optional plural key-pool form. |
| Custom compatible endpoint | `custom` | Requires a base URL, model, and configured custom key environment variable. |

The selected model can be inspected or changed using `/model` and, for a custom endpoint, `/base-url` and `/api-key-env`. Each preset remembers its own model override through `openai_compatible_models` in the settings file.

## 5. API key pools and resilient failover

Miss Data supports one or more API keys for each remote provider. The plural variable, such as `GROQ_API_KEYS`, accepts either a JSON array or comma/newline-separated keys. The singular variable, such as `GROQ_API_KEY`, remains compatible and is included after pool values when present. Duplicate values are removed while preserving order.

```bash
export GROQ_API_KEYS='["first_key", "second_key"]'
export OPENAI_API_KEYS='key_one,key_two'
```

When a provider fails, the agent first tries unused keys from the same pool. It records a one-way key fingerprint in the activity log rather than recording the key itself. If that pool is exhausted, it examines configured provider fallbacks and asks before changing to another company or local backend.

| Command | Effect |
|---|---|
| `/keys` | Displays key counts without printing key values. |
| `/keys show <provider>` | Shows numbered key slots as masked values plus diagnostic fingerprints. |
| `/keys show <provider> reveal` | Asks for separate confirmation, then prints full keys to the local terminal. |
| `/keys add <provider>` | Appends one or more keys to the selected provider pool. |
| `/keys replace <provider>` | Replaces the selected provider’s complete key pool using hidden input. |
| `/keys edit <provider> <number>` | Replaces one numbered key slot using hidden input. |
| `/keys remove <provider> <number>` | Removes one numbered key slot after confirmation; the final removal clears that provider’s stored credentials. |
| `/fallback` | Displays the offered fallback order. |
| `/fallback set groq,openai,anthropic` | Stores a new fallback-offer order. |
| `/fallback off` | Disables cross-provider offers while keeping same-provider key rotation. |

Cross-provider changes always require approval in an interactive session. Non-interactive `--prompt` mode does not silently switch companies.

### Secure credential editor

The terminal key editor treats credentials as sensitive data. `show` is masked by default: it exposes only a small identifying prefix/suffix and a one-way fingerprint, making it practical to distinguish duplicate or expired slots without exposing full values. The `reveal` form requires a second explicit confirmation because a printed key can persist in terminal scrollback, screen recordings, shell logs, or shared sessions. Add, replace, and edit prompts use hidden input, and no key material is written to the activity log. Removing a final key clears both the pooled and backwards-compatible single-key configuration values. If the active provider’s pool changes, Miss Data refreshes that provider immediately; if the final active key is removed, a clear preflight message prevents the next request from failing obscurely.

## 6. Budget profiles and no-cost workspace awareness

The project is designed to be useful with local models and free or limited API tiers. To make response length predictable, a **budget profile** caps generated output tokens without changing the selected provider or model. This is a response-size control rather than a pricing estimate: input context, provider pricing, and tool activity may still affect consumption.

| Profile | Maximum generated output per response | Best use |
|---|---:|---|
| `economy` | 768 tokens | Short explanations, focused edits, and limited free tiers. |
| `balanced` | 2,048 tokens | Everyday implementation and debugging work. |
| `thorough` | 4,096 tokens | Longer implementation summaries and complex tasks. |
| `custom` | 128–16,384 tokens | A deliberate project-specific cap. |

Use `/budget economy`, `/budget balanced`, `/budget thorough`, or `/budget 1024` during a session. The equivalent launch options are `--budget <profile>` and `--output-tokens <N>`; a custom number overrides the selected profile. `/status` displays the active cap in a concise session overview.

The project also provides three no-model-cost awareness commands. `/status` prints the provider, model, budget, safeguards, recovery policies, fallback order, key count, and log path. `/doctor` checks only configuration and the local Ollama health endpoint, without generating text or downloading anything. `/changes` uses read-only Git commands without a shell to summarize branch, staged/untracked entries, and diff statistics. These commands help users orient themselves before spending tokens on an agent request.

## 7. Context-limit and token-size recovery

Long conversations can exceed provider request-size, context-window, or token-per-minute limits. Miss Data detects messages such as a Groq `413 Request too large`, context-length error, or a token-size TPM rejection before it rotates keys or offers another provider.

The default context recovery policy is `ask`. After detecting a qualifying error, the program asks whether it may compact old history and retry the same user request. It uses the built-in conversation summarizer while preserving the newest complete turn. If the provider cannot summarize old context because that summary is also too large, the application keeps the newest complete turn and replaces older history with a truthful local note. It then retries once.

| Command or flag | Meaning |
|---|---|
| `/context-recovery ask` | Ask before context compaction; this is the default. |
| `/context-recovery auto` | Compact and retry once without asking again. |
| `/context-recovery off` | Skip context recovery and continue directly to normal failure handling. |
| `--context-recovery auto` | Set automatic recovery for the launched process. |

A single new prompt that is itself too large cannot be reduced safely by deleting prior history. In that case, shorten the new prompt or split the request into smaller instructions.

## 8. Ollama setup and self-repair

Ollama is the local-model provider. Its default endpoint is `http://localhost:11434`, and the default model setting is `llama3.2`. Change the endpoint with `/ollama-url` and the model with `/model`.

```bash
missdata --provider ollama --model gemma4:e4b
```

If the agent receives a local connection error such as `Connection refused`, it identifies the local Ollama server as unavailable. If a `404` or missing-model error occurs, it identifies that the selected model may not be installed. The program can perform a narrowly scoped repair and retry the same request.

| Failure | User-approved repair | Safety boundary |
|---|---|---|
| Local Ollama server unreachable | Runs `ollama serve` in the background and waits briefly for the local API. | The server is started only for `localhost`, `127.0.0.1`, or `::1` URLs. |
| Selected model missing | Ensures local Ollama is running, then runs `ollama pull <configured-model>`. | The prompt explicitly warns that a model download can use bandwidth, storage, and time. |
| Unknown Ollama error | Does not execute repair commands automatically. | The original error proceeds through normal recovery/failover handling. |

The default policy is `/ollama-recovery ask`, so the program requests consent before it starts a server or downloads a model. `/ollama-recovery auto` is a deliberate pre-approval for these two local-only actions. `/ollama-recovery off` disables the repair workflow. In non-interactive mode, the default `ask` policy does not run commands; `auto` is required for unattended repair.

> **Security note.** The repair workflow never passes a command through a shell. It uses fixed argument lists, does not execute provider-supplied text, and refuses to self-start a service for non-loopback URLs.

## 9. Tool execution, approvals, and sandboxing

The agent can read, write, edit, move, delete, search, and list files; run commands; run short Python snippets; search the public web; and remember durable facts. The exact tools offered to the model are defined in `tools.py` and passed through provider-specific tool schemas.

The approval policy controls whether the user is asked before tool execution.

| Mode | Behavior |
|---|---|
| `always` | Ask before every tool action. |
| `risky` | Ask only before actions marked risky, such as writes, deletes, moves, and command execution. This is the default. |
| `auto` | Execute tools without approval prompts. Use only in trusted environments. |

The sandbox is enabled by default. It confines file-oriented tools to the configured working directory and blocks a targeted set of obviously destructive command patterns. It also applies best-effort process and resource controls where supported. The sandbox is a safety layer for a trusted local workflow; it is not a multi-tenant security boundary and does not make arbitrary user code safe.

| Command | Purpose |
|---|---|
| `/approval <always|risky|auto>` | Change the approval policy. |
| `/sandbox <on|off>` | Enable or disable the working-directory sandbox. |
| `/cwd <path>` | Display or change the agent working directory. |
| `/clear` | Reset the conversation while retaining remembered facts. |
| `/compact [n]` | Manually summarize older conversation while retaining `n` recent turns. |

## 10. Memory

The `remember_fact` tool records concise, durable preferences or project facts in `memory.json`. Those facts are inserted into the next system prompt so they remain useful after a conversation reset or provider switch.

| Command | Purpose |
|---|---|
| `/memory` | List remembered facts. |
| `/forget <n>` | Remove a remembered fact by its displayed index. |

Avoid storing secrets, one-time credentials, or sensitive personal information as remembered facts.

## 11. Activity logs and data handling

Each agent session writes newline-delimited JSON to a local log file. The startup banner prints the current file path, and `/logs` prints it again. Logs capture user requests, provider attempts, key-pool/failover decisions, context and Ollama recovery events, tool requests and results, approvals, errors, and changed files.

| Platform | Default configuration and log location |
|---|---|
| Linux | `~/.config/missdata/` and `~/.config/missdata/logs/` |
| macOS | `~/Library/Application Support/missdata/` and its `logs/` directory |
| Windows | `%APPDATA%\missdata\` and its `logs\` directory |

The logger redacts fields and values that look like API keys, tokens, passwords, authorization headers, cookies, or known secret environment values. It retains one-way key fingerprints for retry diagnostics. Because activity logs can contain user prompts, model outputs, and tool results, treat the log directory as sensitive local data. Session files request user-only permissions on operating systems that support POSIX file modes.

## 12. Stopping an active response safely

Press **Ctrl+C once** while the provider is thinking or streaming a response. Miss Data stops the active provider stream, stops the visual spinner, and records a `turn_cancelled` event in the redacted activity log. Text that was already printed stays visible to the user, but the partial assistant response and matching unfinished user request are deliberately not stored in conversation history. This avoids an orphaned half-turn and ensures that the next prompt starts from the last complete exchange. Cancellation is treated as a user action, not a provider failure, so it does not trigger key rotation, provider failover, context compaction, or Ollama repair.

This command is intended for an active model stream, not a currently running local tool process. Tool actions retain their existing sandbox, timeout, and approval behavior.

## 13. Terminal editing and command history

Interactive TTY sessions use `prompt_toolkit` to provide a consistent line editor across Linux and other supported terminals. Normal left/right cursor movement, backspace/delete within the current line, history recall with up/down arrows, and history search are available inside Miss Data instead of depending on shell-specific input handling. Colored terminal prompts are wrapped in the editor’s ANSI-aware formatter, which prevents raw control sequences such as `^[` from appearing as visible text. Accepted commands are persisted to the user configuration directory at `history`, alongside settings and logs. Empty or interrupted input lines are discarded.

If the session is non-interactive, input/output is redirected, or the editor cannot initialize, Miss Data falls back to ordinary standard input so scripting remains compatible. Install the declared project dependencies to enable the enhanced editor after an upgrade.

## 14. Interactive command reference

| Command | Description |
|---|---|
| `/help` | Display in-program command help. |
| `Ctrl+C` while generating | Stops an active provider response safely without saving an incomplete conversation turn. |
| `/status` | Show active provider, model, response cap, safety settings, recovery policies, fallback order, and log path. |
| `/doctor` | Run no-model-cost configuration and local Ollama-health diagnostics. |
| `/changes` | Show a read-only Git worktree and diff-statistics summary. |
| `/budget <profile\|tokens>` | Choose `economy`, `balanced`, `thorough`, or a custom output-token cap. |
| `/exit`, `/quit` | Exit the interactive session. |
| `/provider <name>` | Switch provider; conversation resets after a successful switch. |
| `/model <name>` | Set the selected model for the current provider. |
| `/ollama-url <url>` | Display or update the Ollama server URL. |
| `/keys show <provider> [reveal]` | Inspects key slots masked by default; reveal only after separate confirmation. |
| `/keys add\|replace <provider>` | Adds to or replaces a provider key pool using hidden input. |
| `/keys edit\|remove <provider> <number>` | Updates or deletes one numbered key slot. |
| `/ollama-recovery <ask|auto|off>` | Configure local Ollama server/model repair. |
| `/gpu-layers <n>|auto` | Override the Ollama GPU layer count or restore automatic selection. |
| `/base-url <url>` | Configure a custom compatible endpoint. |
| `/api-key-env <VAR>` | Configure the custom endpoint credential-variable name. |
| `/keys`, `/keys add <provider>` | Inspect or append remote-provider key pools. |
| `/fallback ...` | Inspect, set, or disable cross-provider fallback offers. |
| `/context-recovery <ask|auto|off>` | Configure oversized-conversation recovery. |
| `/logs` | Display the active session log path. |
| `/memory`, `/forget <n>` | Inspect or remove durable remembered facts. |
| `/compact [n]` | Compact earlier turns, retaining optional recent turns. |
| `/approval <mode>` | Set tool approval policy. |
| `/sandbox <on|off>` | Set sandbox mode. |
| `/lang <en|fa>` | Set assistant response language. |

## 15. Troubleshooting guide

| Symptom | Likely cause | Recommended resolution |
|---|---|---|
| `Request too large`, `413`, context-length, or TPM-size error | Conversation history is larger than the provider can accept. | Approve context recovery, use `/context-recovery auto`, manually run `/compact`, or shorten the current prompt. |
| Same provider is rate-limited | Current key has reached a limit or provider has an outage. | Add keys with `/keys add <provider>`; allow a configured fallback provider when prompted. |
| `Could not reach Ollama` / connection refused | Local Ollama service is not listening. | Approve the offered `ollama serve` repair, or manually start Ollama and verify `/ollama-url`. |
| Ollama model `404` | Configured model is not installed locally. | Approve the offered pull operation or run `ollama pull <model>` manually, then retry. |
| Ollama repair refuses a URL | Endpoint is remote rather than loopback. | Start or maintain the remote service outside Miss Data; the app intentionally will not self-start remote servers. |
| API key rejected | Key is invalid, expired, or lacks access to the selected model. | Save a correct key with `--set-key` or `/keys add`; choose an accessible model with `/model`. |
| Custom provider has no base URL | Custom endpoint was selected without endpoint configuration. | Set `/base-url https://example.com/v1`, choose a model, and set a key variable. |
| File action is blocked | Sandbox blocks a path outside the working directory or a dangerous command. | Use `/cwd` to choose the appropriate project root, review the action, or disable sandbox only in a trusted environment. |

## 16. Development and testing

The repository includes unit tests for provider behavior, tool behavior, conversation compaction, key-pool resilience, context-limit recovery, logging redaction, and Ollama repair policy. Run the suites from the project root after installing dependencies.

```bash
python -m unittest discover -s missdata -p 'test_*.py'
python -m unittest discover -s tests -p 'test_*.py'
python -m compileall -q missdata tests
```

The project uses standard-library networking for Ollama and generic OpenAI-compatible HTTP streaming, while Groq and Anthropic use their respective installed client libraries. Keep provider adapters isolated from the core agent loop when adding another backend. A new OpenAI-compatible provider normally requires a preset entry in `OPENAI_COMPATIBLE_PRESETS`; a provider with a fundamentally different API should receive an adapter that implements the same provider methods used by `Agent`.

When changing resilience behavior, add tests for both success and refusal cases. Recovery tests should mock process launch or model download; they must not start a real server or download a real model during unit testing.

## 17. Operational checklist

Before relying on the program for local development work, verify the active provider, model, working directory, sandbox mode, approval mode, key-pool count, and recovery policies. Review the session log location at startup. For Ollama, ensure the configured URL is local if you expect self-repair, and use the `ask` mode until you intentionally want unattended local server starts or model downloads.

| Check | Command or location |
|---|---|
| Active provider and model | Startup banner or `/provider`, `/model` |
| Response budget | `/budget` or `/status` |
| Local diagnostics | `/doctor` |
| Pending Git changes | `/changes` |
| Working directory | `/cwd` |
| Tool safeguards | `/approval`, `/sandbox` |
| Provider keys | `/keys` |
| Fallback offer order | `/fallback` |
| Context recovery | `/context-recovery` |
| Ollama repair policy | `/ollama-recovery` |
| Session log | `/logs` |
| Active response stop | `Ctrl+C` while generating |
| Secure credential management | `/keys show`, `/keys add`, `/keys replace`, `/keys edit`, `/keys remove` |

## 18. Licensing and support files

Project metadata, dependencies, and licensing information are maintained in `pyproject.toml`. The system instructions used by the model are packaged from `missdata/system_prompt.md`. Update this document alongside public behavior changes so command descriptions, safety guarantees, configuration names, and recovery policies remain accurate.


## 19. Local-first workflow suite

The workflow suite is intended to make Miss Data practical on constrained API plans and with local models. Its local inspection commands do not send source files to a provider. Model-backed commands remain opt-in and continue to use the active provider, configured output budget, approval setting, and sandbox boundary.

| Capability | Command | Provider usage | Safeguard |
|---|---|---:|---|
| Project map | `/map` | None | Reads local directory markers, manifests, entry points, and test layout only. |
| Suggested tests | `/test` | None | `/test run <n>` passes through normal command approval. |
| Context meter | `/context` | None | Labels the result as a character-based approximation, not billing data. |
| Planned execution | `/mode plan` | One no-tool planning response | A request remains pending until `/approve`; `/reject` discards it. |
| Diff preview | `/diff [revision]` | None | Read-only Git command output is capped to avoid runaway terminal output. |
| Checkpoint | `/checkpoint [name]` | None | Explains that all changes are staged and requires confirmation before committing. |
| Restore | `/restore <revision>` | None | Verifies the revision and requires a hard-restore confirmation. |
| Session resume | `/sessions`, `/resume <id>` | None | Session files are local and created with user-only permissions where supported. |
| Read-only review | `/review [path]` | Active model only | The review turn excludes write, delete, move, memory, and shell-command tools. |
| Privacy cleanup | `/privacy clear ...` | None | Each deletion request requires confirmation. |

### 19.1 Project map, test discovery, and context awareness

`/map` recognizes common Python, Node, Rust, Go, Java, C/C++, Maven, Docker, and Makefile indicators and shows a compact summary rather than traversing known dependency/cache directories. It also surfaces the first detected test command. `/test` lists all compatible common commands discovered from local markers. The user can still direct the model to use a different project-specific command, but `/test run <n>` makes the normal test route visible without spending a model turn.

`/context` is preventative support for provider request limits. It reports characters and a deliberately approximate token conversion using roughly four characters per token. This value is not a context-window guarantee, an API usage report, or a price estimate. It should be used alongside `/compact` and the existing context-limit recovery controls.

### 19.2 Plan-first execution and review

`/mode direct` is the ordinary agent workflow. `/mode plan` performs a no-tool planning pass for a normal user request, retains the original request only in a pending state, and presents the plan. `/approve` sends the original request to the normal agent loop; `/reject` removes the pending request. This provides a low-friction way to inspect likely files, validation, and assumptions before actions begin.

`/profile explore` selects the economy output cap and direct mode for quick questions. `/profile build` selects the thorough cap and direct mode for implementation. `/profile review` selects a balanced cap and plan mode. These profiles intentionally do **not** switch API company, API key, or model; this keeps account and cost decisions explicit. A user can still change provider or model through the existing commands.

`/review [path]` is a model-backed code review path with a reduced tool list. The review may read, list, grep, locate files, check the working directory, locate executables, or use public web search. It cannot write files, edit files, delete/move paths, run a shell command, execute Python, or record memory. The review prompt requests severity-ranked findings covering correctness, security, test coverage, and maintainability.

### 19.3 Git checkpoints, diff, and restore

The Git workflow operates only when the working directory is a Git repository. `/diff` renders a compact file-statistic summary plus a bounded unified diff. `/checkpoint <name>` is explicit because it invokes `git add -A` and creates a local commit; it will never run without confirmation. `/checkpoints` lists recent commits so that a user can inspect their short revisions.

`/restore <revision>` runs a verified `git reset --hard <revision>` only after displaying a hard-loss warning and receiving confirmation. It can destroy uncommitted working-tree changes, so it is deliberately not exposed as a model-side automatic action. Create a checkpoint before broad agent work when an easy rollback point is desired.

### 19.4 Session storage and privacy

Completed turns are saved locally in the Miss Data configuration directory under `sessions/`. A saved session includes a user-selected or generated title, timestamps, provider/model metadata, working directory, log reference, and conversation messages. `/sessions` lists IDs; `/resume <id>` restores the saved provider/model when it can be initialized and rebuilds its system message. The current local working directory is not silently changed when a session resumes.

| Command | Result |
|---|---|
| `/session-name <name>` | Renames and saves the active local conversation. |
| `/new-session` | Saves the active conversation and starts a clean one. |
| `/delete-session <id>` | Removes one selected saved session after confirmation. |
| `/privacy` | Shows sessions, prompt history, and log locations. |
| `/privacy clear logs|sessions|history|all` | Removes selected local data only after confirmation. |

Session persistence does not make local disk encryption, account isolation, or backups automatic. Users should protect their account and device, avoid putting secrets in prompts, and use the privacy cleanup command when a local conversation should not remain available.

### 19.5 Trusted self-update

Miss Data supports `/update` and `/update apply` only when the currently running package is a Git checkout of the trusted `https://github.com/RootedMani/Miss-Data.git` repository. A status check fetches only the configured trusted remote and compares the active named branch. An apply action is fast-forward only, refuses a dirty worktree, refuses detached HEAD, does not merge, does not reset source files, and requires a separate confirmation.

The updater does not download code from arbitrary links, accept a remote supplied by an AI model, install dependencies automatically, or update a project in the agent’s working directory. It updates only the Miss Data source checkout. Restart the program after a successful update. If the source’s declared dependencies changed, manually run `pip install -r requirements.txt` in the source checkout after reviewing the change.

Natural-language update requests may use the restricted `update_missdata` agent tool. That tool is marked risky, checks the trusted source first, and the system instruction requires a fresh explicit user confirmation before an apply action. Users can always use the more transparent `/update` path directly.

### 19.6 Shell completion

`/completion bash`, `/completion zsh`, and `/completion fish` print a small shell-specific completion definition for common launch flags. Redirect the result into the appropriate shell completion file if desired. The command prints text only; it does not modify shell startup files.

## 20. Migration guidance

Existing settings remain compatible. New `execution_mode` and `work_profile` settings use `direct` and `build` defaults respectively. No existing API key, provider, or log configuration is changed. Sessions begin being saved after this version’s completed turns; older activity logs remain unaffected. Install any new declared dependencies after updating from source, then restart the program.


### 20.1 Portable settings backup

`/export-config [path]` creates a portable JSON document with format marker `missdata-settings-backup` and version `1`. The document contains only the serializable `Settings` fields: selected provider/model preferences, safety and recovery policies, output budget/work profile, language, sandbox choice, custom-endpoint settings, and fallback order. API keys and key pools are stored separately and are never read into the backup. Logs, saved sessions, terminal history, memory, and project files are also excluded.

`/import-config <path>` validates the format/version and previews the imported provider, model, budget, and execution mode. It asks for confirmation before applying. The application then attempts to initialize the imported provider using keys that already exist on the current machine. If initialization fails, all prior settings are restored and the imported configuration is not saved. This prevents a backup from silently leaving an active session pointed at an unusable provider.


## 21. In-program manual and capability awareness

Miss Data includes a no-model-cost terminal manual modeled on the discoverability of Unix `man` pages. It uses a single maintained internal source (`manual.py`) for command-topic pages, aliases, keyword search, examples, safety notes, and the compact capability reference injected into the agent’s system prompt.

| User action | Result |
|---|---|
| `/help` | Prints the compact command index and points to the manual. |
| `/help <topic>` | Opens a focused manual page. |
| `/man` | Lists supported manual topics. |
| `/man <topic>` | Renders a page with **SYNOPSIS**, **DESCRIPTION**, **EXAMPLES**, **SAFETY NOTE**, and related pages. |
| `/man search <words>` | Searches page names, aliases, synopsis text, and descriptions. |

The initial manual pages are `overview`, `getting-started`, `commands`, `providers`, `keys`, `resilience`, `workflows`, `git`, `sessions`, `safety`, `privacy`, `update`, `backup`, and `troubleshooting`. Command-like topic input is accepted, so `/man /keys` opens the `keys` page and aliases such as `/man upgrade` locate the `update` page.

### 21.1 Model capability reference

The agent prompt includes a compact capability reference generated by `manual.capability_reference()` from the same manual-page registry. This design avoids a separate hand-maintained prompt list drifting away from the actual product manual. The instruction requires the model, when asked how to use Miss Data, to provide the exact command or supported natural-language route, mention safety conditions for credentials, deletion, updates, privacy, or destructive operations, and refer the user to the relevant manual page.

The model must not invent a command or claim an unsupported integration. If a requested feature is not in the reference, it should say so directly and offer the closest documented workflow. When adding a user-facing feature, maintainers should update the manual registry, the compact `/help` index where appropriate, the README, and this reference documentation; the model then receives the refreshed capability card automatically at the next system-prompt reset.
