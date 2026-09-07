# Miss Data (خانم داده)

> **Autonomous Full-Stack Web & Terminal Coding Agent powered by Google Gemini**

Miss Data is an interactive, local-first coding assistant and development environment. It combines an autonomous AI coding loop with an intuitive web-based IDE, a sandboxed command runner, a workspace file explorer, integrated Git controls with instant rollback checkpoints, durable cross-session memory, and a built-in Unix `man`-style documentation manual.

Whether you are refactoring code, writing tests, exploring unfamiliar codebases, or inspecting Git diffs, Miss Data operates safely within your project workspace through strict path confinement and configurable human-in-the-loop approval gating.

---

## Highlights & Features

- **Autonomous Coding Agent**: Powered by Google Gemini (`@google/genai`), capable of reading, creating, surgically editing, and searching files, executing shell commands, and iteratively solving complex engineering tasks.
- **Interactive Web Terminal & IDE**: Real-time conversational interface with rich syntax highlighting, collapsible tool call traces, streaming status indicators, and turn-by-turn "Files Touched" summaries.
- **Human-in-the-Loop Safeguards**: Granular approval policies (`risky`, `always`, `auto`). Risky actions like file overwrites, deletions, or shell commands require explicit approval unless pre-authorized.
- **Strict Sandbox Confinement**: File operations are strictly confined to the active working directory to prevent path traversal (`../`) or accidental system file manipulation. Dangerous shell patterns (`rm -rf /`, `sudo`, fork bombs) are blocked.
- **Visual Git & Checkpoint Management**: Live worktree inspection, color-coded unified diff viewer, one-click change discarding, and instant commit checkpoints with rollback capability.
- **Sandboxed Shell Terminal Drawer**: Run shell commands directly in the project workspace with real-time stdout, stderr, and exit-code reporting.
- **Workspace File Explorer & Editor**: Browse project files in real time, view syntax-highlighted source code, and perform manual edits directly in the browser.
- **Durable Memory (`/memory`)**: Store long-term facts, developer preferences, and architectural rules that persist across conversations and session resets.
- **Multi-Session Management (`/sessions`)**: Create, switch, rename, and manage multiple parallel sessions without losing conversation state.
- **Built-in Unix Manual (`/man`)**: Comprehensive, zero-token in-app documentation with keyword search and actionable command examples.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Tailwind CSS v4, Motion (Framer Motion), Lucide Icons, Vite |
| **Backend** | Node.js, Express, ES Modules, `@google/genai` (Google Gen AI SDK), `child_process` |
| **Tooling & Bundling** | Vite (Client build), `esbuild` (Server CJS bundle), `tsx` (TypeScript development runtime) |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                 Miss Data Web IDE Interface                 │
│  Terminal • File Explorer • Git Panel • Shell • Manual      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / REST API
┌──────────────────────────────▼──────────────────────────────┐
│                    Express Backend Server                   │
│   /api/chat • /api/approval • /api/files • /api/git • ...   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│    Gemini Agent Service     │ │      Sandbox Controller     │
│   • Tool calling loop       │ │   • Path confinement        │
│   • Human approvals         │ │   • Command blocklist       │
│   • Memory & Sessions       │ │   • File operations & grep  │
└──────────────┬──────────────┘ └──────────────┬──────────────┘
               │                               │
        Google Gemini API                Local Workspace
```

---

## Quick Start

### Prerequisites

- **Node.js** 18+ (or Bun)
- **Git** installed on your system
- A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/)

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/RootedMani/Miss-Data.git
cd Miss-Data

# Install npm dependencies
npm install
```

### 2. Configure Environment

Create a `.env` file in the root directory (based on `.env.example`):

```bash
cp .env.example .env
```

Add your Gemini API key to `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Start Development Server

Launch the full-stack application (frontend + backend via `tsx` and Vite):

```bash
npm run dev
```

Open your browser and navigate to **`http://localhost:3000`**.

### 4. Production Build

To compile both client and server for production:

```bash
# Builds Vite static assets and bundles server.ts to dist/server.cjs
npm run build

# Start production server
npm start
```

---

## Interface Tour

### 1. Interactive Agent Terminal
The main view functions like an intelligent developer terminal. When you ask Miss Data to solve a task:
- The agent reasons through the solution and calls tools autonomously.
- If an action is marked **Risky** (such as editing code or running a script), a pending approval card appears with **Approve**, **Approve All (Turn)**, or **Reject** buttons.
- Tool executions show live collapsible accordions with exact inputs and outputs.
- At the end of each turn, a green **Files Touched** banner clearly lists all modified files.

### 2. Workspace Explorer
Click **Workspace** in the top navigation bar to open the file explorer drawer:
- Navigate files and directories in real time.
- Click any file to view its contents in an editor.
- Make manual changes and click **Save Changes** to write directly to disk.

### 3. Git Control & Checkpoints
Click **Git** in the header to open the version control panel:
- **Worktree Status**: See your current branch, remote status, ahead/behind counts, and clean/dirty state.
- **Diff Viewer**: View live colorized unified diffs of uncommitted changes.
- **Checkpoints**: Click **Create Checkpoint** to create an instantaneous named commit before risky modifications.
- **Discard & Rollback**: Revert uncommitted changes with **Discard Changes** or roll back to previous checkpoints with one click.

### 4. Sandboxed Shell Drawer
Click **Shell** in the header to open a direct command runner:
- Execute commands (e.g. `npm test`, `git log`, `ls -la`, `cat file`) directly in the workspace.
- View standard output, error streams, and exit codes in real time.

### 5. Multi-Session Drawer
Click the session title or **Sessions** button:
- View saved conversations, message counts, and timestamps.
- Start a new clean session, rename the active session, or switch between prior tasks.

### 6. Durable Memory (`/memory`)
Click **Memory** to open long-term facts:
- Store persistent instructions (e.g., *"Always write unit tests using Vitest"*, *"Use 2-space indentation"*).
- Miss Data automatically injects these facts into every future system prompt.

---

## Slash Commands Reference

Type these commands directly into the terminal prompt or command palette:

| Command | Arguments | Description |
|---|---|---|
| `/help` | `[topic]` | Displays the commands index or opens a specific manual page |
| `/man` | `[topic]` | Opens the built-in Unix man-page manual modal |
| `/status` | — | Displays active model, sandbox mode, approval policy, and token budget |
| `/doctor` | — | Runs no-model-cost diagnostics on workspace paths, Git, and environment |
| `/map` | — | Analyzes workspace structure, detected languages, manifests, and test suites |
| `/test` | `[run N]` | Discovers available test commands; runs selected test through approval gating |
| `/review` | `[path]` | Performs a read-only code review without modifying any files |
| `/diff` | `[revision]` | Displays unified diff of uncommitted changes or specified revision |
| `/checkpoint` | `[name]` | Stages and commits current working tree as a named restore point |
| `/restore` | `<revision>` | Confirms and executes hard rollback to a listed Git commit |
| `/discard` | — | Reverts all uncommitted changes (`git restore . && git clean -fd`) |
| `/approval` | `always\|risky\|auto` | Changes tool approval mode |
| `/sandbox` | `on\|off` | Enables or disables working-directory confinement |
| `/budget` | `economy\|balanced\|thorough\|<N>` | Sets maximum output token budget cap |
| `/mode` | `direct\|plan` | Switches between direct execution and plan-first confirmation mode |
| `/memory` | — | Displays remembered long-term facts |
| `/forget` | `<number>` | Deletes a stored memory fact by index |
| `/sessions` | — | Lists saved conversations and session IDs |
| `/new-session` | `[title]` | Archives current session and opens a fresh conversation |
| `/cwd` | `[path]` | Shows or updates the active sandbox working directory |
| `/clear` | — | Clears messages in the active session (preserves memory facts) |
| `/lang` | `en\|fa` | Sets agent response language (English / Persian) |

---

## Safety & Security Model

Miss Data was designed from the ground up to prevent unintended destruction of your code:

### 1. The Sandbox Confinement Layer
- All file tools (`read_file`, `write_file`, `edit_file`, `delete_path`, etc.) are resolved against the canonical project root.
- Path traversal exploits (`../../etc/passwd`, absolute root paths, external symlinks) are caught and rejected immediately.
- Shell commands run strictly with `cwd` set to the project root.

### 2. Destructive Command Deny-List
Commands executed by the agent or in the shell drawer are inspected for high-risk patterns. Destructive patterns are blocked:
- Root deletion (`rm -rf /`, `rm -rf /*`, `rm -rf ~`)
- Partition formatters (`mkfs`, `dd if=... of=/dev/...`)
- System power commands (`shutdown`, `reboot`, `init 0`)
- Privilege escalation (`sudo`, `su -`)
- Fork bombs and uncontrolled pipelines (`:(){ :|:& };:`, `curl ... | sh`)

### 3. Approval Gating
- **`risky` (Default)**: Automatically runs read-only actions (`read_file`, `list_dir`, `search_files`, `grep`); prompts for your approval before writing files, deleting files, or executing shell commands.
- **`always`**: Prompts before every single tool action.
- **`auto`**: Runs without prompting (recommended only in isolated containers or disposable sandboxes).

### 4. Secret Redaction
Activity logs, terminal outputs, and session snapshots automatically redact detected API keys, authorization tokens, and credentials.

---

## Project Directory Structure

```
Miss-Data/
├── server/                     # Backend agent services & tooling
│   ├── agent.ts                # Gemini agent engine, tool loop, slash commands
│   ├── git.ts                  # Git status, diff, checkpoint, and rollback actions
│   ├── manual.ts               # Unix man-page style manual registry and search
│   ├── sandbox.ts              # File confinement, safety checks, and command execution
│   └── types.ts                # Server-side TypeScript interfaces and data models
├── src/                        # Frontend React 18 Application
│   ├── components/             # Modular UI components
│   │   ├── CommandPalette.tsx  # Quick shortcut & command launcher
│   │   ├── GitPanel.tsx        # Visual Git control, diffs, and checkpoints
│   │   ├── ManualModal.tsx     # In-app interactive manual viewer
│   │   ├── MemoryModal.tsx     # Durable memory facts editor
│   │   ├── SessionsDrawer.tsx  # Multi-session manager
│   │   ├── SettingsModal.tsx   # Model, approval, and budget configuration
│   │   ├── ShellDrawer.tsx     # Direct sandboxed command terminal
│   │   ├── Terminal.tsx        # Chat stream, approval cards, and tool accordions
│   │   ├── WorkflowsPanel.tsx  # Quick workflow action shortcuts (/map, /test, etc.)
│   │   └── WorkspaceExplorer.tsx # Real-time file explorer and editor
│   ├── App.tsx                 # Root application shell and header layout
│   ├── index.css               # Global Tailwind CSS styling
│   ├── main.tsx                # React DOM entry point
│   └── types.ts                # Client-side TypeScript interfaces
├── DOCUMENTATION.md            # Comprehensive technical reference manual
├── README.md                   # Project overview and quick start guide
├── index.html                  # HTML entry point
├── metadata.json               # Platform configuration and capabilities
├── package.json                # Project dependencies and build scripts
├── server.ts                   # Express server entry point & Vite middleware
├── tsconfig.json               # TypeScript compilation settings
└── vite.config.ts              # Vite build and development configuration
```

---

## REST API Reference

The backend provides a clean REST API utilized by the frontend:

- `POST /api/chat`: Send a prompt or slash command to the agent loop.
- `POST /api/approval`: Resolve a pending tool approval (`approve`, `always`, or `reject`).
- `GET /api/status`: Retrieve active agent configuration, memory count, and sandbox status.
- `POST /api/config`: Update agent settings (model, approval mode, token budget, etc.).
- `GET /api/files`: List directory contents within the sandbox.
- `GET /api/file`: Read file contents.
- `POST /api/file`: Save or update a file.
- `GET /api/git/status`: Get branch, remote, and worktree status.
- `GET /api/git/diff`: Get unified diff of uncommitted changes.
- `POST /api/git/action`: Execute a Git action (`checkpoint`, `discard`, `commit`, etc.).
- `POST /api/terminal/exec`: Run a shell command in the sandbox.
- `GET /api/manual`: Retrieve all manual pages or search query matches.
- `GET /api/memory`: Get all durable memory facts.
- `POST /api/memory/add`: Add a new durable memory fact.
- `DELETE /api/memory/:id`: Delete a durable memory fact.
- `GET /api/sessions`: List saved conversation sessions.
- `POST /api/sessions`: Create, switch, or rename a session.

For complete API payload schemas, request/response examples, and error codes, refer to [DOCUMENTATION.md](DOCUMENTATION.md).

---

## License

This project is licensed under the MIT License.
