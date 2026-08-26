# Miss Data (خانم داده)

A terminal coding agent. It reads and edits files, searches your codebase, runs shell commands, and remembers durable facts across sessions — all from the command line. Works with **Groq**, **Anthropic (Claude)**, **Ollama** (local models), or any **OpenAI-compatible API** (DeepSeek, OpenAI, OpenRouter, Together AI, Mistral, Fireworks, xAI/Grok, Moonshot/Kimi, Perplexity, or a fully custom endpoint) as the LLM backend, switchable at any time.

> **Complete reference:** See [DOCUMENTATION.md](DOCUMENTATION.md) for the full installation, architecture, provider, security, resilience, Ollama recovery, logging, troubleshooting, and development guide.

This is a CLI tool today; it's built so a web frontend can be layered on top of the same `missdata` package later (the `Agent` class in `missdata/agent.py` is UI-agnostic — the CLI is just one interface to it).

---

## 1. Requirements

- Python 3.9 or newer
- An API key for **at least one** provider:
  - [Groq](https://console.groq.com/keys) (fast, generous free tier)
  - [Anthropic](https://console.anthropic.com/settings/keys) (Claude models)
  - [DeepSeek](https://platform.deepseek.com/api_keys), [OpenAI](https://platform.openai.com/api-keys), [OpenRouter](https://openrouter.ai/keys), [Together AI](https://api.together.ai/settings/api-keys), [Mistral](https://console.mistral.ai/api-keys), [Fireworks](https://fireworks.ai/api-keys), [xAI](https://console.x.ai), or [Moonshot](https://platform.moonshot.cn/console/api-keys) — any OpenAI-compatible service works out of the box
  - or [Ollama](https://ollama.com) running locally — no API key needed

## 2. Install

### Linux / macOS

```bash
git clone <https://github.com/RootedMani/Miss-Data>
cd miss_data
./setup.sh
source .venv/bin/activate
missdata
```

### Windows

```bat
git clone <https://github.com/RootedMani/Miss-Data>
cd miss_data
setup.bat
.venv\Scripts\activate
missdata
```

### Manual install (any OS, if you prefer)

```bash
python -m venv .venv
# Linux/macOS:
source .venv/bin/activate
# Windows:
.venv\Scripts\activate

pip install -e .
missdata
```

### Without installing at all

If you just want to run it in place:

```bash
pip install -r requirements.txt
python run.py
```

### SOCKS proxy users

Miss Data supports `socks://` proxy environment variables from common desktop
proxy clients by converting them to the `socks5://` form required by its HTTP
client. Install the project's dependencies so SOCKS support is available:

```bash
pip install -r requirements.txt
```

If you do not intend to use a proxy, remove stale `ALL_PROXY`, `HTTP_PROXY`,
and `HTTPS_PROXY` environment variables before launching the app.

## 3. First run

The first time you run `missdata`, it will ask for an API key for whichever provider you're using (Groq by default) and save it to a config file — it does **not** get stored inside the project folder, so it's safe from accidental commits. You can also set it up ahead of time:

```bash
missdata --set-key groq
missdata --set-key anthropic
missdata --set-key deepseek
missdata --set-key openrouter
missdata --set-key custom      # any other OpenAI-compatible endpoint
missdata --add-key groq        # append additional Groq keys without displaying existing ones
```

Each `--set-key` prompt can collect multiple keys. Keys are tried in the order you provide them when the active provider reports an error or reaches a limit. Use `--add-key <provider>` or `/keys add <provider>` to append more keys later.

Or set environment variables directly:

```bash
export GROQ_API_KEY=your_key_here          # Linux/macOS
export ANTHROPIC_API_KEY=your_key_here
export DEEPSEEK_API_KEY=your_key_here
export OPENROUTER_API_KEY=your_key_here
# ...and so on — see .env.example for the full list of provider env vars

set GROQ_API_KEY=your_key_here             # Windows (cmd)
$env:GROQ_API_KEY="your_key_here"          # Windows (PowerShell)
```

For an ordered pool, use the plural variable as a JSON array (the singular variable remains supported for backwards compatibility):

```bash
export GROQ_API_KEYS='["first_key", "second_key"]'
export OPENAI_API_KEYS='["first_key", "second_key"]'
```

**Using a "custom" OpenAI-compatible endpoint** (self-hosted, enterprise gateway, or any provider not built in): point it at the base URL and model, then set the key under whatever env var name you like:

```bash
missdata --provider custom --base-url https://my-endpoint.example.com/v1 --model my-model
missdata --set-key custom   # saved under CUSTOM_API_KEY by default; change with /api-key-env
```

## 4. Usage

```bash
missdata                          # start in the current directory
missdata --dir /path/to/project   # start in a specific project directory
missdata --provider anthropic     # use Claude for this session
missdata --provider deepseek      # use DeepSeek for this session
missdata --model llama-3.3-70b-versatile
missdata --approval auto          # don't ask for confirmation on risky actions
missdata --context-recovery auto  # compact context and retry automatically after request-size errors
missdata --ollama-recovery ask    # ask before starting local Ollama or downloading a missing model
missdata --sandbox off            # disable the filesystem/command sandbox (see §6a)
missdata -p "list the files in this repo"   # run one prompt non-interactively
```

Once inside, just type what you want:

```
You › find any TODO comments in this project and list them
You › refactor the sort function in utils.py to use quicksort, then run the tests
You › /provider deepseek
You › create a Flask app with a health check endpoint
```

### Slash commands

| Command | What it does |
|---|---|
| `/help` | Show available commands |
| `/exit`, `/quit` | Exit |
| `/clear` | Clear the conversation (keeps long-term memory) |
| `/compact [n]` | Summarize older turns into one note to shrink context; optionally keep the last `n` turns verbatim |
| `/memory` | Show remembered facts |
| `/forget <n>` | Remove remembered fact `n` |
| `/cwd [path]` | Show or change the working directory |
| `/provider <name>` | Switch LLM backend mid-session (`groq`, `anthropic`, `ollama`, `deepseek`, `openai`, `openrouter`, `together`, `mistral`, `fireworks`, `xai`, `moonshot`, `perplexity`, or `custom`) |
| `/keys` | Show the number of configured keys for each provider without exposing the keys |
| `/keys add <provider>` | Append one or more keys to a provider's automatic retry pool |
| `/fallback` | Show the ordered providers that can be offered after the active provider is exhausted |
| `/fallback set <provider,...>` | Set the order in which configured alternative providers are offered |
| `/fallback off` | Disable cross-provider offers while keeping same-provider key rotation enabled |
| `/context-recovery <ask\|auto\|off>` | On context/token-limit errors, ask before compacting, compact automatically, or disable this recovery |
| `/ollama-recovery <ask\|auto\|off>` | On local Ollama connection/model errors, ask before repair, repair automatically, or disable repair |
| `/logs` | Print the current session's activity log file path |
| `/model <name>` | Change the model for the current provider |
| `/ollama-url <url>` | Set the Ollama server URL (default `http://localhost:11434`) |
| `/base-url <url>` | Set the API base URL used by the `custom` provider |
| `/api-key-env <VAR>` | Set which environment variable the `custom` provider reads its key from |
| `/approval <always\|risky\|auto>` | Change confirmation behavior |
| `/sandbox <on\|off>` | Confine file tools to cwd + block dangerous commands (default: on) |
| `/lang <en\|fa>` | Set the assistant's response language (English is the default) |

## 5. Resilience, provider switching, and logs

Miss Data first retries the current provider with the next configured key. If its configured key pool is exhausted, it finds the next configured provider in the `/fallback` order and **asks before switching companies**. For example, a failed OpenAI request can prompt: `Switch to Groq (...) and retry your request? [y/N]`. A refusal leaves the provider unchanged and reports the original failure. This protects you from an unapproved switch to a different account, pricing model, or data processor.

A provider change starts a fresh conversation because tool-call message formats differ across APIs. If actions have already run in that turn, the confirmation clearly warns that replaying the original request could repeat them. The program does not silently switch a provider in `--prompt` mode because that mode is non-interactive.

Before rotating a key or offering a different provider, Miss Data now detects request-size, context-window, and token-per-minute size errors such as Groq `413` errors. With the default `/context-recovery ask`, it asks: `Compact older conversation context and retry? [y/N]`. It uses the built-in summary compaction while preserving the newest turn, so the failed request can be retried; if the provider cannot summarize the old history because that summary is also too large, it safely discards only older complete turns and clearly records that fact. Set `/context-recovery auto` (or launch with `--context-recovery auto`) to approve this recovery in advance, or `/context-recovery off` to bypass it. A single oversized user message cannot be made smaller automatically, so that situation still requires shortening the request.

When the active provider is Ollama and it reports a connection-refused or missing-model failure, Miss Data identifies the problem before provider failover. With the default `/ollama-recovery ask`, it asks permission to run the narrowly scoped local repair: `ollama serve` for a stopped local server, or `ollama pull <model>` for a missing model. It retries the original request once after a confirmed repair. `/ollama-recovery auto` pre-approves only those local actions; `/ollama-recovery off` disables them. The application refuses to self-start a remote Ollama endpoint and never sends recovery commands through a shell.

Each session writes a privacy-conscious, newline-delimited JSON activity log. It records prompts, provider attempts, key fingerprints (never key values), provider responses, tool requests/results, approvals, switches, errors, and files touched. Values that look like API keys, tokens, passwords, authorization headers, or known environment secrets are redacted before logging. At startup the CLI prints the file location; use `/logs` to show it again.

| Platform | Log directory |
|---|---|
| Linux | `~/.config/missdata/logs/` |
| macOS | `~/Library/Application Support/missdata/logs/` |
| Windows | `%APPDATA%\\missdata\\logs\\` |

## 6. Approval modes

Miss Data can take real actions on your machine (writing files, running shell commands, deleting things). You control how cautious it is:

- **`always`** — confirm every tool call, even read-only ones.
- **`risky`** *(default)* — only confirm risky actions: writing/editing/deleting files, moving files, and running shell commands. Reads, searches, and directory listings run without asking.
- **`auto`** — never ask; the agent acts freely. Use this only in throwaway/sandboxed environments or when you trust the task fully.

Set it with `--approval` at launch, or `/approval <mode>` mid-session. During an approval prompt, answering `a` approves that tool type for the rest of the session.

## 6a. Sandbox (on by default)

Independently of approval mode, Miss Data sandboxes what its tools are physically able to do:

- **Filesystem confinement.** `read_file`, `write_file`, `edit_file`, `delete_path`, `move_path`, `make_dir`, `list_dir`, `search_files`, and `grep` cannot resolve to anything outside the agent's working directory — not via `../..`, not via an absolute path, not via a symlink that points outside it. An attempt is refused with a clear error instead of silently failing or touching the wrong file.
- **Command guarding.** `run_command` and `run_python` refuse a short deny-list of unambiguously destructive patterns (`rm -rf /`, disk-wiping `dd`/`mkfs`, fork bombs, `shutdown`/`reboot`, `sudo`, `curl | sh`-style pipe-to-shell, recursive `chmod`/`chown` on `/`). This is a safety net for footguns, not a general security boundary.
- **Resource limits + clean timeouts.** Shell/Python commands run with best-effort CPU, memory, and process-count limits (POSIX only), and on timeout the *entire process group* is killed — so a command that spawns children (a dev server, a pipeline) can't outlive its timeout as an orphan.

This is confinement for a trusted local agent, not a hardened multi-tenant jail — inside the working directory, `run_command` still has real shell access within the resource limits. Turn it off with `--sandbox off` or `/sandbox off` if you fully trust a task and need it to reach outside the project directory; do this only in a throwaway or already-trusted environment. The banner shows current sandbox status on startup.

## 7. What it can do (tools)

- `read_file`, `write_file`, `edit_file` (precise find/replace), `delete_path`, `move_path`, `make_dir`
- `list_dir` (tree view, skips `.git`/`node_modules`/etc.), `search_files` (glob), `grep` (content search)
- `run_command` — shell command in the working directory (bash on Linux/macOS, cmd on Windows), sandboxed as above
- `run_python` — quick Python snippet (`python -c <code>`) without writing a temp file, same sandboxing as `run_command`
- `web_search` — search the public web and return source titles/URLs. Uses the Brave Search API if `BRAVE_API_KEY` is set (free tier at https://brave.com/search/api/, more reliable); otherwise falls back automatically to scraping DuckDuckGo, which needs no key but can occasionally be rate-limited. Queries must not contain secrets or private code
- `remember_fact` — saves a durable fact to memory, available in future sessions

After each turn, Miss Data prints a **"Files touched this turn"** summary listing every file it created, edited, deleted, or moved — so it's always clear what changed on disk without scrolling back through the tool-call log.

## 8. Project layout

```
miss_data/
├── missdata/
│   ├── cli.py            # argument parsing, REPL, slash commands
│   ├── agent.py           # core turn loop, approval gating
│   ├── providers.py        # Groq, Anthropic, Ollama, and OpenAI-compatible (DeepSeek, etc.) adapters behind one interface
│   ├── tools.py            # file/shell tool implementations + schemas
│   ├── sandbox.py          # path confinement, dangerous-command deny-list, resource limits
│   ├── memory.py           # persistent facts
│   ├── config.py           # settings + API key storage (cross-platform paths)
│   ├── activity.py         # structured session logging with secret redaction
│   ├── ollama_recovery.py  # safe local Ollama server/model repair helpers
│   ├── ui.py               # terminal colors/formatting
│   └── system_prompt.md    # agent's instructions
├── run.py                  # run without installing
├── setup.sh / setup.bat    # one-step venv + install
├── pyproject.toml
├── requirements.txt
└── DOCUMENTATION.md        # complete user and maintainer reference
```

## 9. Where config lives

- Linux: `~/.config/missdata/`
- macOS: `~/Library/Application Support/missdata/`
- Windows: `%APPDATA%\missdata\`

This holds `settings.json` (provider/model/approval choice and fallback order), `memory.json` (remembered facts), `.env` (API keys and optional pools), and `logs/` (session activity records) — separate from any project you point it at.

## 10. Security notes

- API keys are stored in your user config directory, not inside a project folder, so they won't get committed to a repo by accident. Key-pool values are never printed or placed in activity logs.
- Activity logs retain prompts and tool output so treat `logs/` as sensitive local data. The logger redacts credential-like values and creates session files with user-only permissions where the operating system supports them.
- `run_command`/`run_python` execute real code with your user's permissions, subject to the sandbox described in §5a — review what's about to run, especially in `auto` approval mode.
- The sandbox confines *where* tools can act and blocks the most obviously destructive commands; it does not vet arbitrary code for subtler harm. Review risky actions, especially in `auto` mode.
- The agent refuses to write malware/exploits and will flag obvious security issues (SQL injection, hardcoded secrets, etc.) it notices in code it touches, but it is not a substitute for a real security review.

## 11. Roadmap (web version)

The `Agent` class is deliberately decoupled from the terminal (`ui.py` is the only CLI-specific piece it talks to indirectly via callbacks). A future web frontend can drive `missdata.agent.Agent` directly — swap the input/output layer, keep the tool execution and provider logic as-is.
