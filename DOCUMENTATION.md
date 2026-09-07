# Miss Data: Technical Documentation & Reference Manual

Welcome to the comprehensive technical documentation for **Miss Data (خانم داده)**. This manual provides an exhaustive architectural, operational, and development reference for engineers, developers, and operators deploying or extending the Miss Data coding agent platform.

---

## Table of Contents

1. [System Architecture & Design Philosophy](#1-system-architecture--design-philosophy)
2. [Agent Execution Lifecycle](#2-agent-execution-lifecycle)
3. [Backend Subsystems & Core Modules](#3-backend-subsystems--core-modules)
   - [3.1 Agent Service (`server/agent.ts`)](#31-agent-service-serveragentts)
   - [3.2 Sandbox Controller (`server/sandbox.ts`)](#32-sandbox-controller-serversandboxts)
   - [3.3 Git Subsystem (`server/git.ts`)](#33-git-subsystem-servergitts)
   - [3.4 Manual & Knowledge Registry (`server/manual.ts`)](#34-manual--knowledge-registry-servermanualts)
4. [Autonomous Tool Catalog & Schema](#4-autonomous-tool-catalog--schema)
5. [Safety, Confinement & Security Architecture](#5-safety-confinement--security-architecture)
   - [5.1 Path Confinement & Traversal Guards](#51-path-confinement--traversal-guards)
   - [5.2 Dangerous Command Deny-List](#52-dangerous-command-deny-list)
   - [5.3 Approval Modes & Human-in-the-Loop](#53-approval-modes--human-in-the-loop)
   - [5.4 Secret Redaction in Activity Logs](#54-secret-redaction-in-activity-logs)
6. [Complete REST API Specification](#6-complete-rest-api-specification)
7. [Frontend Architecture & UI Subsystems](#7-frontend-architecture--ui-subsystems)
8. [Slash Commands & Local Workflows](#8-slash-commands--local-workflows)
9. [Configuration & Environment Reference](#9-configuration--environment-reference)
10. [Build, Deployment & Production Packaging](#10-build-deployment--production-packaging)
11. [Troubleshooting, Error Codes & Diagnostics](#11-troubleshooting-error-codes--diagnostics)

---

## 1. System Architecture & Design Philosophy

Miss Data is structured as a full-stack, client-server web application written entirely in **TypeScript**. The application is architected around three foundational design tenets:

1. **Local-First Autonomy**: The coding agent runs on the user's system and interacts directly with the project directory. File operations and command executions happen locally with zero cloud proxying of user code.
2. **Strict Confinement & Defense-in-Depth**: Because autonomous agents generate and execute code, safety cannot depend solely on model prompts. Miss Data enforces physical filesystem containment, command blacklists, and interactive approval checkpoints on all state-altering actions.
3. **Observability & Immediate Rollback**: Every turn clearly highlights touched files. Built-in Git diff inspection and instant snapshot checkpoints enable one-click rollback if an agent action yields unintended side effects.

### High-Level Architectural Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                             BROWSER CLIENT                                 │
│                                                                            │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌────────────────┐  │
│  │   Agent Terminal      │  │  Workspace Explorer   │  │   Git Panel    │  │
│  │  • Real-time Stream   │  │  • File Tree Browser  │  │  • Live Diff   │  │
│  │  • Approval Cards     │  │  • In-browser Editor  │  │  • Checkpoints │  │
│  │  • Tool Accordions    │  │  • Direct File Save   │  │  • Rollback    │  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └───────┬────────┘  │
│              │                          │                      │           │
│              └──────────────────────────┼──────────────────────┘           │
│                                         │ HTTP REST Calls                  │
└─────────────────────────────────────────┼──────────────────────────────────┘
                                          │
                                          ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                      EXPRESS BACKEND SERVER (Port 3000)                    │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                       HTTP REST Router (`server.ts`)                 │  │
│  │    /api/chat        /api/approval     /api/files      /api/git/*     │  │
│  │    /api/terminal    /api/manual       /api/memory     /api/sessions  │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                      │
│                ┌────────────────────┴───────────────────┐                  │
│                ▼                                        ▼                  │
│  ┌───────────────────────────┐            ┌─────────────────────────────┐  │
│  │       AgentService        │            │      Sandbox Controller     │  │
│  │  • Turn Orchestrator      │            │  • Path Canonicalization    │  │
│  │  • Gemini SDK Integration │            │  • Traversal Prevention     │  │
│  │  • Memory & Sessions      │◄──────────►│  • Deny-List Command Guard  │  │
│  │  • Approval Interceptor   │            │  • child_process Runner     │  │
│  └─────────────┬─────────────┘            └─────────────┬───────────────┘  │
│                │                                        │                  │
└────────────────┼────────────────────────────────────────┼──────────────────┘
                 ▼                                        ▼
      ┌────────────────────┐                   ┌────────────────────┐
      │ Google Gemini API  │                   │ Project Filesystem │
      │  gemini-2.5-flash  │                   │   & Git Worktree   │
      └────────────────────┘                   └────────────────────┘
```

---

## 2. Agent Execution Lifecycle

When a user submits a prompt, Miss Data executes a multi-stage turn cycle:

```
[ User Input ]
       │
       ▼
[ Slash Command Check ] ──(Starts with '/')──► [ Direct Local Execution ] ──► [ Return UI Result ]
       │ (Normal prompt)
       ▼
[ System Prompt & Context Assembly ]
  • Working directory status
  • Durable Memory facts
  • Project file map & manual references
       │
       ▼
[ Call Gemini API (@google/genai) ]
       │
       ├────────────────────────────────────────┐
       ▼ (Model returns text)                   ▼ (Model requests tool call)
[ Append Assistant Message ]              [ Inspect Tool & Arguments ]
       │                                        │
[ Render in Terminal ]                          ▼
                                          [ Is Action Risky? ]
                                                │
                         ┌──────────────────────┴──────────────────────┐
                         ▼ (Yes & Mode=risky/always)                   ▼ (No or Mode=auto)
                  [ Halt Turn ]                                 [ Execute Tool in Sandbox ]
                  [ Create Pending Approval ]                          │
                  [ Wait for User Decision ]                           ▼
                         │                                      [ Append Tool Result ]
     ┌───────────────────┴───────────────────┐                         │
     ▼ (Approve)                             ▼ (Reject)                ▼
[ Execute in Sandbox ]                [ Record Rejection ]      [ Send Result to Gemini ]
     │                                       │                         │
     └───────────────────┬───────────────────┘                         ▼
                         │                                     [ Next Turn / Final Answer ]
                         ▼
             [ Compute Files Touched ]
                         │
                         ▼
                 [ Complete Turn ]
```

### Turn Loop Guarantees
- **Non-blocking Human Approvals**: If an action is flagged as risky, execution pauses safely and persists the pending state in memory. The user can review the exact command or file patch before confirming.
- **Session Continuity**: All tool calls, results, and assistant thoughts within a turn are tracked in the active session's message history.
- **Touched Files Tracking**: Any tool that writes, edits, deletes, or moves files logs the target path into a turn set, which is surfaced directly to the user in the UI.

---

## 3. Backend Subsystems & Core Modules

### 3.1 Agent Service (`server/agent.ts`)
The `AgentService` class serves as the brain of the backend:
- **Model Orchestration**: Leverages `@google/genai` (Google Gen AI TypeScript SDK) utilizing models such as `gemini-2.5-flash` or `gemini-2.0-flash`.
- **System Prompt Formulation**: Automatically formats context including current directory (`cwd`), active approval policy, budget limits, durable memory facts, and tool schemas.
- **Approval State Management**: Maintains `pendingApproval`, storing tool call ID, target arguments, and human-readable action summaries.
- **Session Persistence**: Maintains conversation sessions in a thread-safe in-memory map with unique session IDs, titles, and timestamps.
- **Activity Logging**: Emits structured JSON events into an in-memory ring buffer (up to 200 events), automatically stripping sensitive tokens.

### 3.2 Sandbox Controller (`server/sandbox.ts`)
The `Sandbox` class enforces containment boundaries:
- **Canonical Path Resolution**: Uses `path.resolve` and `path.relative` to ensure any targeted path resides strictly within the root workspace directory.
- **File System Operations**: Implements atomic read, write, targeted find-and-replace editing (`edit_file`), recursive directory creation, item deletion, and file moving.
- **Search & Grep Engines**: Includes recursive directory traversal with exclusion filters for standard noise directories (`.git`, `node_modules`, `dist`, `.next`), glob matching, and regex line grepping.
- **Process Spawning**: Executes shell commands via `child_process.execSync` with a default 15,000ms timeout and capped 200KB output buffer.

### 3.3 Git Subsystem (`server/git.ts`)
The Git subsystem provides headless version control capabilities:
- **Status Parsing**: Runs `git status --porcelain=v1 -b` and parses branch identity, ahead/behind counters, modified files, and untracked entries without invoking external dependencies.
- **Diff Generation**: Executes `git diff HEAD` (bounded to 400 lines or 30KB) to prevent UI freezing on massive file additions.
- **Checkpoints & Reversion**:
  - `checkpoint`: Automatically stages all changes (`git add -A`) and creates a commit with the prefix `checkpoint: <name>`.
  - `rollback`: Performs a verified hard reset (`git reset --hard <revision>`) after checking revision validity.
  - `discard`: Reverts uncommitted edits and cleans untracked files (`git restore . && git clean -fd`).

### 3.4 Manual & Knowledge Registry (`server/manual.ts`)
A dedicated reference system that provides zero-token documentation:
- Contains structured pages for `missdata`, `getting-started`, `commands`, `providers`, `keys`, `resilience`, `workflows`, `git`, `sessions`, `safety`, `privacy`, `update`, and `troubleshooting`.
- Features keyword and alias searching across synopsis, description, examples, and safety constraints.

---

## 4. Autonomous Tool Catalog & Schema

Miss Data exposes 13 purpose-built tools to the Gemini agent. Every tool is strictly typed and bounded:

| Tool Name | Parameters | Description | Safety Level |
|---|---|---|---|
| `read_file` | `path: string` | Reads up to 250 lines from a designated file within the workspace. | Safe (Auto) |
| `write_file` | `path: string, content: string` | Creates a new file or overwrites an existing file with the provided string. | **Risky** |
| `edit_file` | `path: string, targetContent: string, replacementContent: string` | Performs surgical find-and-replace on a unique substring inside a file. | **Risky** |
| `delete_path` | `path: string` | Permanently deletes a file or directory inside the workspace. | **Risky** |
| `move_path` | `source: string, destination: string` | Moves or renames a file or folder within the workspace. | **Risky** |
| `make_dir` | `path: string` | Creates a directory and any necessary parent directories. | Safe (Auto) |
| `list_dir` | `path?: string, depth?: number` | Lists directory items hierarchically up to specified depth (default 3). | Safe (Auto) |
| `search_files` | `pattern: string` | Searches files matching a glob pattern (e.g. `*.tsx`, `**/*.json`). | Safe (Auto) |
| `grep` | `query: string, filePattern?: string` | Searches for exact text or regex matches across workspace files. | Safe (Auto) |
| `run_command` | `command: string` | Executes a shell command inside the workspace directory. | **Risky** |
| `run_python` | `code: string` | Executes a short inline Python script (`python3 -c ...`). | **Risky** |
| `remember_fact` | `fact: string` | Stores a permanent fact or guideline into durable cross-session memory. | Safe (Auto) |
| `web_search` | `query: string` | Queries search documentation and repository resources. | Safe (Auto) |

---

## 5. Safety, Confinement & Security Architecture

### 5.1 Path Confinement & Traversal Guards
The `Sandbox.resolveSafePath(userPath)` algorithm enforces strict path boundaries:

```typescript
const resolved = path.resolve(this.cwd, userPath);
const rel = path.relative(this.cwd, resolved);

if (rel.startsWith('..') || path.isAbsolute(userPath) && !resolved.startsWith(this.cwd)) {
  return { error: `Path traversal denied: '${userPath}' is outside workspace root` };
}
```

- Any attempt to access `/etc/passwd`, `~/.ssh/id_rsa`, or use `../../` to escape the workspace directory is immediately rejected with a traversal error.
- Symlinks pointing outside the workspace boundary are rejected.

### 5.2 Dangerous Command Deny-List
Before `run_command` or direct shell executions occur, the command string is evaluated against regular expressions targeting catastrophic actions:

- **Root & Home Deletion**: `\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-f?[a-zA-Z]*r)\s+[/~]`
- **Block Device Wiping**: `\b(mkfs|dd\s+if=.*of=\/dev\/)`
- **System Halts**: `\b(shutdown|reboot|poweroff|init\s+0)\b`
- **Privilege Escalation**: `\b(sudo|su\s+-)\b`
- **Fork Bombs**: `:\(\)\s*\{.*:\s*\|\s*:.*\&.*\}\s*;.*:`
- **Arbitrary Remote Code Execution**: `curl\s+.*\s*\|\s*(ba)?sh`

### 5.3 Approval Modes & Human-in-the-Loop
Users configure the level of agent autonomy via `/approval` or the UI Settings modal:

1. **`risky` (Default)**:
   - Read-only operations (`read_file`, `list_dir`, `search_files`, `grep`, `remember_fact`) run immediately without user prompts.
   - Any mutation (`write_file`, `edit_file`, `delete_path`, `move_path`, `run_command`, `run_python`) halts the turn and presents a pending approval card with the exact arguments.
2. **`always`**:
   - Every single tool call, including reads and directory listings, requires user confirmation.
3. **`auto`**:
   - Unattended execution. Tools execute immediately without prompting. Recommended only in disposable container sandboxes.

### 5.4 Secret Redaction in Activity Logs
All log events passing through `AgentService.logEvent` are scrubbed before storage:
- Key names containing `key`, `secret`, `token`, or `auth` have their values masked:
  - Long values (> 8 chars) are truncated: `abc...xyz`.
  - Short values are replaced with `***`.

---

## 6. Complete REST API Specification

The Express backend provides clean, strongly typed REST endpoints consumed by the React frontend or custom integrations.

### Core Endpoints

#### `GET /api/health`
Checks server responsiveness.
- **Response `200 OK`**:
  ```json
  { "status": "ok", "name": "Miss Data" }
  ```

#### `GET /api/status`
Retrieves current agent configuration, working directory, and stats.
- **Response `200 OK`**:
  ```json
  {
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "cwd": "/workspace",
    "approvalMode": "risky",
    "sandboxMode": true,
    "budgetProfile": "balanced",
    "maxOutputTokens": 2048,
    "responseLanguage": "en",
    "executionMode": "direct",
    "contextRecovery": "auto",
    "ollamaRecovery": "ask",
    "memoryCount": 2,
    "sessionTitle": "Refactor parser",
    "sessionId": "session-default",
    "touchedFilesCount": 3,
    "availableProviders": ["gemini", "groq", "anthropic", "ollama", "openai"],
    "configuredKeys": { "gemini": true, "groq": false }
  }
  ```

#### `POST /api/chat`
Sends a prompt or slash command to the agent loop.
- **Request Body**:
  ```json
  { "prompt": "Find all exported functions in server/agent.ts" }
  ```
- **Response `200 OK`**:
  ```json
  {
    "message": {
      "id": "msg-12345",
      "role": "assistant",
      "content": "I scanned server/agent.ts and found...",
      "timestamp": 1741300000000,
      "touchedFiles": []
    },
    "messages": [ ... ],
    "status": { ... }
  }
  ```

#### `POST /api/approval`
Resolves a pending tool approval from a previous turn.
- **Request Body**:
  ```json
  {
    "messageId": "msg-12345",
    "action": "approve" // "approve" | "always" | "reject"
  }
  ```
- **Response `200 OK`**: Updated message list and status.

---

### Filesystem Endpoints

#### `GET /api/files?path=.`
Lists directory contents within the sandbox.
- **Response `200 OK`**:
  ```json
  {
    "items": [
      { "name": "server.ts", "path": "server.ts", "type": "file", "size": 7880 },
      { "name": "src", "path": "src", "type": "directory" }
    ]
  }
  ```

#### `GET /api/file?path=server.ts`
Reads the content of a file.
- **Response `200 OK`**:
  ```json
  { "content": "import express from 'express';..." }
  ```

#### `POST /api/file`
Writes or saves content to a file.
- **Request Body**:
  ```json
  { "path": "notes.txt", "content": "Updated notes" }
  ```
- **Response `200 OK`**:
  ```json
  { "success": true, "bytesWritten": 13 }
  ```

---

### Git & Version Control Endpoints

#### `GET /api/git/status`
Returns Git worktree and branch diagnostics.
- **Response `200 OK`**:
  ```json
  {
    "branch": "main",
    "remoteUrl": "https://github.com/RootedMani/Miss-Data.git",
    "isClean": false,
    "modifiedFiles": ["server/agent.ts"],
    "untrackedFiles": ["newfile.txt"],
    "ahead": 0,
    "behind": 0,
    "diverged": false
  }
  ```

#### `GET /api/git/diff`
Returns the current unified diff.
- **Response `200 OK`**:
  ```json
  { "diff": "diff --git a/server/agent.ts b/server/agent.ts\n..." }
  ```

#### `POST /api/git/action`
Executes an explicit Git operation.
- **Request Body**:
  ```json
  {
    "action": "checkpoint", // "checkpoint" | "discard" | "commit" | "rollback"
    "message": "before refactor"
  }
  ```
- **Response `200 OK`**:
  ```json
  { "success": true, "output": "[main 8a1b2c] checkpoint: before refactor" }
  ```

---

### Terminal & Shell Endpoints

#### `POST /api/terminal/exec`
Executes an arbitrary shell command directly in the sandbox working directory.
- **Request Body**:
  ```json
  { "command": "npm test" }
  ```
- **Response `200 OK`**:
  ```json
  { "stdout": "Test Suites: 12 passed", "stderr": "", "exitCode": 0 }
  ```

---

### Knowledge & Memory Endpoints

#### `GET /api/manual?q=searchterm`
Retrieves manual documentation pages or queries by keyword.

#### `GET /api/memory`
Retrieves all recorded durable memory facts.
- **Response `200 OK`**:
  ```json
  {
    "facts": [
      { "id": 1, "fact": "Use Tailwind CSS utility classes directly", "createdAt": 1741299000000 }
    ]
  }
  ```

#### `POST /api/memory/add`
Adds a new durable fact.
- **Request Body**:
  ```json
  { "fact": "Prefer TypeScript functional components" }
  ```

#### `DELETE /api/memory/:id`
Deletes a durable memory fact by ID.

---

### Sessions Endpoints

#### `GET /api/sessions`
Lists all conversations and the active session ID.

#### `POST /api/sessions`
Creates, switches, or renames conversations.
- **Request Body**:
  ```json
  { "action": "new", "title": "Build Auth API" }
  // or { "action": "switch", "id": "session-123" }
  // or { "action": "rename", "id": "session-123", "title": "New Title" }
  ```

---

## 7. Frontend Architecture & UI Subsystems

The user interface is built as a single-page application utilizing **React 18**, **Tailwind CSS v4**, and **Motion** for smooth animations and transitions.

```
┌────────────────────────────────────────────────────────────┐
│                         App.tsx                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Top Navigation Bar: Status, Workflows, Modals, CWD   │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                     Terminal.tsx                     │  │
│  │  • Message list & Markdown rendering                 │  │
│  │  • Interactive Pending Approval Cards                │  │
│  │  • Tool execution detail accordions                  │  │
│  │  • Terminal input prompt & slash completion          │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Drawers & Modals:                                    │  │
│  │  • WorkspaceExplorer  • GitPanel     • ShellDrawer   │  │
│  │  • SessionsDrawer     • ManualModal  • MemoryModal   │  │
│  │  • SettingsModal      • CommandPalette               │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### Key Components

- **`Terminal.tsx`**: Renders the conversation stream. Parses assistant markdown, formats syntax-highlighted code blocks, handles tool execution cards, and renders human-in-the-loop approval requests with clear diffs.
- **`WorkspaceExplorer.tsx`**: An interactive sidebar drawer allowing users to browse directories, inspect files, and edit source code in real time with dirty-state tracking.
- **`GitPanel.tsx`**: A visual Git management console with status summaries, color-coded unified diff viewer, one-click change discarding, and instant checkpoint commit creation.
- **`ShellDrawer.tsx`**: A drop-down command terminal running directly in the sandbox with live command history and exit-code badges.
- **`ManualModal.tsx`**: A searchable Unix-inspired manual viewer with categorized tabs, synopses, safety notes, and copyable command snippets.
- **`CommandPalette.tsx`**: A quick keyboard-driven launcher (`Cmd/Ctrl+K`) for switching models, running workflows, or invoking slash commands.

---

## 8. Slash Commands & Local Workflows

Slash commands provide zero-token local utilities that execute instantly on the backend without invoking the LLM:

| Slash Command | Action & Mechanism |
|---|---|
| `/status` | Returns a diagnostic snapshot of provider, model, token budget, approval mode, and sandbox status. |
| `/doctor` | Checks local environment health: Git status, Node version, directory readability, and process bounds. |
| `/map` | Inspects workspace manifests (`package.json`, `tsconfig.json`, etc.) to generate a project overview and detect test commands. |
| `/test` | Discovers available test suites. `/test run 1` runs the first suggested test suite through approval gating. |
| `/review [path]` | Launches a read-only code review prompt with file-mutation tools disabled. |
| `/diff [revision]` | Renders a bounded unified diff of uncommitted changes or compares against a git revision. |
| `/checkpoint [name]`| Creates a named git commit staging all current project changes. |
| `/restore <rev>` | Prompts for confirmation and resets the worktree to a previous revision (`git reset --hard`). |
| `/discard` | Immediately clears all working tree modifications (`git restore . && git clean -fd`). |
| `/memory` | Lists all active durable memory facts. |
| `/forget <id>` | Removes a durable memory fact by its numeric identifier. |
| `/sessions` | Lists all saved conversations. |
| `/new-session [name]`| Starts a fresh conversation while safely archiving the current session. |
| `/cwd [path]` | Displays or updates the active working directory for the sandbox. |
| `/clear` | Clears conversation messages in the current session (preserves memory facts). |
| `/approval <mode>` | Switches approval mode between `risky`, `always`, and `auto`. |
| `/sandbox <on\|off>`| Toggles filesystem confinement. |
| `/budget <profile>` | Sets output budget cap: `economy` (768), `balanced` (2048), `thorough` (4096), or custom token count. |
| `/lang <en\|fa>` | Changes agent response language between English and Persian. |

---

## 9. Configuration & Environment Reference

Miss Data uses standard environment variables defined in `.env` (or inherited from the system):

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yes** | — | Google Gemini API key used by the `@google/genai` SDK. |
| `PORT` | No | `3000` | Port for the Express server and web IDE. |
| `NODE_ENV` | No | `development` | Environment mode (`development` or `production`). |
| `GROQ_API_KEY` | No | — | Optional secondary provider key for Groq. |
| `ANTHROPIC_API_KEY` | No | — | Optional secondary provider key for Claude. |
| `OPENAI_API_KEY` | No | — | Optional secondary provider key for OpenAI models. |

---

## 10. Build, Deployment & Production Packaging

Miss Data uses a unified dual-build strategy combining **Vite** for the client and **esbuild** for the backend server.

### Scripts Defined in `package.json`

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "lint": "tsc --noEmit",
    "start": "node dist/server.cjs"
  }
}
```

### Build Mechanics
1. **Frontend Compilation**: `vite build` optimizes React components, tree-shakes dependencies, and outputs static HTML/CSS/JS into the `dist/` directory.
2. **Backend Bundling**: `esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`
   - Resolves all server-side TypeScript imports at build time.
   - Bundles the server into a single CommonJS file (`dist/server.cjs`), eliminating ES module relative import issues during deployment.
   - Excludes heavy runtime packages via `--packages=external`.
3. **Production Serving**: In production (`NODE_ENV=production`), `dist/server.cjs` mounts `dist/` via `express.static` and serves the single-page application fallback.

---

## 11. Troubleshooting, Error Codes & Diagnostics

| Error / Symptom | Root Cause | Resolution |
|---|---|---|
| `GEMINI_API_KEY is not set` | Missing API key in environment or `.env` file. | Obtain an API key from Google AI Studio and add `GEMINI_API_KEY=your_key` to `.env`. |
| `Path traversal denied: '...' is outside workspace root` | An agent tool or user command targeted a file outside the sandbox boundary. | Ensure paths are relative to the workspace directory. If external access is required, toggle `/sandbox off`. |
| `Command blocked by safety filter` | A command matched destructive deny-list patterns (e.g. `rm -rf /` or `sudo`). | Revise the command to operate on specific local files without elevated privileges. |
| `Port 3000 is already in use (EADDRINUSE)` | Another process is holding port 3000. | Terminate the conflicting process using `kill $(lsof -t -i:3000)` and restart with `npm run dev`. |
| `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` | The backend returned an HTML error page instead of a JSON API response. | Check server terminal logs. Ensure all server imports are properly resolved. |
| `Git working tree has uncommitted changes` | An update or restore operation requires a clean working tree. | Use `/diff` to inspect changes, `/checkpoint` to save them, or `/discard` to revert them. |

---

*Miss Data is maintained by RootedMani. For issues, updates, and contributions, visit the official repository at [https://github.com/RootedMani/Miss-Data.git](https://github.com/RootedMani/Miss-Data.git).*
