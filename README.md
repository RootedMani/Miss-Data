# Miss Data (خانم داده)

A terminal coding agent. It reads and edits files, searches your codebase, runs shell commands, and remembers durable facts across sessions — all from the command line. Works with **Groq** or **Anthropic (Claude)** as the LLM backend, switchable at any time.

This is a CLI tool today; it's built so a web frontend can be layered on top of the same `missdata` package later (the `Agent` class in `missdata/agent.py` is UI-agnostic — the CLI is just one interface to it).

---

## 1. Requirements

- Python 3.9 or newer
- An API key for **at least one** of:
  - [Groq](https://console.groq.com/keys) (fast, generous free tier)
  - [Anthropic](https://console.anthropic.com/settings/keys) (Claude models)

## 2. Install

### Linux / macOS

```bash
git clone <this-repo-or-unzip-it>
cd miss_data
./setup.sh
source .venv/bin/activate
missdata
```

### Windows

```bat
git clone <this-repo-or-unzip-it>
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

## 3. First run

The first time you run `missdata`, it will ask for an API key for whichever provider you're using (Groq by default) and save it to a config file — it does **not** get stored inside the project folder, so it's safe from accidental commits. You can also set it up ahead of time:

```bash
missdata --set-key groq
missdata --set-key anthropic
```

Or set environment variables directly:

```bash
export GROQ_API_KEY=your_key_here        # Linux/macOS
export ANTHROPIC_API_KEY=your_key_here

set GROQ_API_KEY=your_key_here           # Windows (cmd)
$env:GROQ_API_KEY="your_key_here"        # Windows (PowerShell)
```

## 4. Usage

```bash
missdata                          # start in the current directory
missdata --dir /path/to/project   # start in a specific project directory
missdata --provider anthropic     # use Claude for this session
missdata --model llama-3.3-70b-versatile
missdata --approval auto          # don't ask for confirmation on risky actions
missdata --sandbox off            # disable the filesystem/command sandbox (see §5a)
missdata -p "list the files in this repo"   # run one prompt non-interactively
```

Once inside, just type what you want:

```
You › find any TODO comments in this project and list them
You › refactor the sort function in utils.py to use quicksort, then run the tests
You › /provider anthropic
You › create a Flask app with a health check endpoint
```

### Slash commands

| Command | What it does |
|---|---|
| `/help` | Show available commands |
| `/exit`, `/quit` | Exit |
| `/clear` | Clear the conversation (keeps long-term memory) |
| `/memory` | Show remembered facts |
| `/forget <n>` | Remove remembered fact `n` |
| `/cwd [path]` | Show or change the working directory |
| `/provider <groq\|anthropic>` | Switch LLM backend mid-session |
| `/model <name>` | Change the model for the current provider |
| `/approval <always\|risky\|auto>` | Change confirmation behavior |
| `/sandbox <on\|off>` | Confine file tools to cwd + block dangerous commands (default: on) |
| `/lang <en\|fa>` | Set the assistant's response language (English is the default) |

## 5. Approval modes

Miss Data can take real actions on your machine (writing files, running shell commands, deleting things). You control how cautious it is:

- **`always`** — confirm every tool call, even read-only ones.
- **`risky`** *(default)* — only confirm risky actions: writing/editing/deleting files, moving files, and running shell commands. Reads, searches, and directory listings run without asking.
- **`auto`** — never ask; the agent acts freely. Use this only in throwaway/sandboxed environments or when you trust the task fully.

Set it with `--approval` at launch, or `/approval <mode>` mid-session. During an approval prompt, answering `a` approves that tool type for the rest of the session.

## 5a. Sandbox (on by default)

Independently of approval mode, Miss Data sandboxes what its tools are physically able to do:

- **Filesystem confinement.** `read_file`, `write_file`, `edit_file`, `delete_path`, `move_path`, `make_dir`, `list_dir`, `search_files`, and `grep` cannot resolve to anything outside the agent's working directory — not via `../..`, not via an absolute path, not via a symlink that points outside it. An attempt is refused with a clear error instead of silently failing or touching the wrong file.
- **Command guarding.** `run_command` and `run_python` refuse a short deny-list of unambiguously destructive patterns (`rm -rf /`, disk-wiping `dd`/`mkfs`, fork bombs, `shutdown`/`reboot`, `sudo`, `curl | sh`-style pipe-to-shell, recursive `chmod`/`chown` on `/`). This is a safety net for footguns, not a general security boundary.
- **Resource limits + clean timeouts.** Shell/Python commands run with best-effort CPU, memory, and process-count limits (POSIX only), and on timeout the *entire process group* is killed — so a command that spawns children (a dev server, a pipeline) can't outlive its timeout as an orphan.

This is confinement for a trusted local agent, not a hardened multi-tenant jail — inside the working directory, `run_command` still has real shell access within the resource limits. Turn it off with `--sandbox off` or `/sandbox off` if you fully trust a task and need it to reach outside the project directory; do this only in a throwaway or already-trusted environment. The banner shows current sandbox status on startup.

## 6. What it can do (tools)

- `read_file`, `write_file`, `edit_file` (precise find/replace), `delete_path`, `move_path`, `make_dir`
- `list_dir` (tree view, skips `.git`/`node_modules`/etc.), `search_files` (glob), `grep` (content search)
- `run_command` — shell command in the working directory (bash on Linux/macOS, cmd on Windows), sandboxed as above
- `run_python` — quick Python snippet (`python -c <code>`) without writing a temp file, same sandboxing as `run_command`
- `web_search` — search the public web with DuckDuckGo and return source titles/URLs; queries must not contain secrets or private code
- `remember_fact` — saves a durable fact to memory, available in future sessions

After each turn, Miss Data prints a **"Files touched this turn"** summary listing every file it created, edited, deleted, or moved — so it's always clear what changed on disk without scrolling back through the tool-call log.

## 7. Project layout

```
miss_data/
├── missdata/
│   ├── cli.py            # argument parsing, REPL, slash commands
│   ├── agent.py           # core turn loop, approval gating
│   ├── providers.py        # Groq + Anthropic adapters behind one interface
│   ├── tools.py            # file/shell tool implementations + schemas
│   ├── sandbox.py          # path confinement, dangerous-command deny-list, resource limits
│   ├── memory.py           # persistent facts
│   ├── config.py           # settings + API key storage (cross-platform paths)
│   ├── ui.py               # terminal colors/formatting
│   └── system_prompt.md    # agent's instructions
├── run.py                  # run without installing
├── setup.sh / setup.bat    # one-step venv + install
├── pyproject.toml
└── requirements.txt
```

## 8. Where config lives

- Linux: `~/.config/missdata/`
- macOS: `~/Library/Application Support/missdata/`
- Windows: `%APPDATA%\missdata\`

This holds `settings.json` (provider/model/approval choice), `memory.json` (remembered facts), and `.env` (API keys) — separate from any project you point it at.

## 9. Security notes

- API keys are stored in your user config directory, not inside a project folder, so they won't get committed to a repo by accident.
- `run_command`/`run_python` execute real code with your user's permissions, subject to the sandbox described in §5a — review what's about to run, especially in `auto` approval mode.
- The sandbox confines *where* tools can act and blocks the most obviously destructive commands; it does not vet arbitrary code for subtler harm. Review risky actions, especially in `auto` mode.
- The agent refuses to write malware/exploits and will flag obvious security issues (SQL injection, hardcoded secrets, etc.) it notices in code it touches, but it is not a substitute for a real security review.

## 10. Roadmap (web version)

The `Agent` class is deliberately decoupled from the terminal (`ui.py` is the only CLI-specific piece it talks to indirectly via callbacks). A future web frontend can drive `missdata.agent.Agent` directly — swap the input/output layer, keep the tool execution and provider logic as-is.
