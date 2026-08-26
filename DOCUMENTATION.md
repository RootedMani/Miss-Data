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
| `/keys add <provider>` | Appends one or more keys to the selected provider pool. |
| `/fallback` | Displays the offered fallback order. |
| `/fallback set groq,openai,anthropic` | Stores a new fallback-offer order. |
| `/fallback off` | Disables cross-provider offers while keeping same-provider key rotation. |

Cross-provider changes always require approval in an interactive session. Non-interactive `--prompt` mode does not silently switch companies.

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

## 12. Interactive command reference

| Command | Description |
|---|---|
| `/help` | Display in-program command help. |
| `/status` | Show active provider, model, response cap, safety settings, recovery policies, fallback order, and log path. |
| `/doctor` | Run no-model-cost configuration and local Ollama-health diagnostics. |
| `/changes` | Show a read-only Git worktree and diff-statistics summary. |
| `/budget <profile\|tokens>` | Choose `economy`, `balanced`, `thorough`, or a custom output-token cap. |
| `/exit`, `/quit` | Exit the interactive session. |
| `/provider <name>` | Switch provider; conversation resets after a successful switch. |
| `/model <name>` | Set the selected model for the current provider. |
| `/ollama-url <url>` | Display or update the Ollama server URL. |
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

## 13. Troubleshooting guide

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

## 14. Development and testing

The repository includes unit tests for provider behavior, tool behavior, conversation compaction, key-pool resilience, context-limit recovery, logging redaction, and Ollama repair policy. Run the suites from the project root after installing dependencies.

```bash
python -m unittest discover -s missdata -p 'test_*.py'
python -m unittest discover -s tests -p 'test_*.py'
python -m compileall -q missdata tests
```

The project uses standard-library networking for Ollama and generic OpenAI-compatible HTTP streaming, while Groq and Anthropic use their respective installed client libraries. Keep provider adapters isolated from the core agent loop when adding another backend. A new OpenAI-compatible provider normally requires a preset entry in `OPENAI_COMPATIBLE_PRESETS`; a provider with a fundamentally different API should receive an adapter that implements the same provider methods used by `Agent`.

When changing resilience behavior, add tests for both success and refusal cases. Recovery tests should mock process launch or model download; they must not start a real server or download a real model during unit testing.

## 15. Operational checklist

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

## 16. Licensing and support files

Project metadata, dependencies, and licensing information are maintained in `pyproject.toml`. The system instructions used by the model are packaged from `missdata/system_prompt.md`. Update this document alongside public behavior changes so command descriptions, safety guarantees, configuration names, and recovery policies remain accurate.
