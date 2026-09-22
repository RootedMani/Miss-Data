export interface ManualPage {
  name: string;
  category: 'core' | 'workspace' | 'config' | 'safeguards' | 'vcs' | 'interface' | 'memory' | 'utilities' | 'guides';
  synopsis: string;
  description: string;
  options?: { opt: string; desc: string }[];
  examples: string[];
  safety?: string;
  seeAlso?: string[];
  aliases?: string[];
}

export const MANUAL_PAGES: Record<string, ManualPage> = {
  // ==========================================
  // 1. CORE COMMANDS
  // ==========================================
  overview: {
    name: "overview",
    category: "guides",
    synopsis: "missdata [options] [prompt]",
    description: "Miss Data (خانم داده) is an interactive terminal coding agent designed for local repository engineering. She reads and edits files, runs sandboxed shell commands, analyzes git trees, and persists durable memory facts across sessions. Built with zero-cost local tools to keep token consumption minimal while providing resilient multi-provider LLM orchestration.",
    examples: [
      "/help",
      "/status",
      "/doctor",
      "/man getting-started",
      "/map"
    ],
    seeAlso: ["getting-started", "architecture", "commands", "workflows"],
    aliases: ["missdata", "about", "intro"]
  },

  "getting-started": {
    name: "getting-started",
    category: "guides",
    synopsis: "Type requests directly into the prompt or use /slash commands",
    description: "Welcome to Miss Data. Getting started is simple:\n1. Check your active workspace and LLM settings with `/status`.\n2. Run `/doctor` to verify your environment without spending any model tokens.\n3. Run `/map` to explore the workspace structure and discover project test scripts.\n4. Ask coding prompts directly (e.g. 'explain how the routing works', 'refactor server.ts').\n5. Use arrow keys (↑ / ↓) to recall command history, and Tab or Right Arrow to accept ghost autocompletions.",
    examples: [
      "/status",
      "/doctor",
      "/map",
      "/mode plan",
      "Inspect package.json and summarize external dependencies"
    ],
    seeAlso: ["overview", "map", "status", "mode"],
    aliases: ["start", "begin", "quickstart", "tutorial"]
  },

  help: {
    name: "help",
    category: "core",
    synopsis: "/help [command | topic]",
    description: "Displays the primary command index or in-depth documentation for a specified command or topic. When called with no arguments, `/help` prints a categorized table of available commands. When called with an argument, it automatically opens the corresponding manual entry.",
    options: [
      { opt: "[command]", desc: "Specific command name (e.g. /help status, /help budget)" },
      { opt: "[topic]", desc: "Conceptual guide name (e.g. /help workflows, /help safety)" }
    ],
    examples: [
      "/help",
      "/help status",
      "/help budget",
      "/help doctor",
      "/help git"
    ],
    seeAlso: ["man", "status", "commands"],
    aliases: ["?", "/?"]
  },

  man: {
    name: "man",
    category: "core",
    synopsis: "/man [command | topic | search <words>]",
    description: "Opens built-in reference manual pages formatted like Unix man(1). Every command and conceptual subsystem in Miss Data has a dedicated manual detailing syntax, options, behavior, examples, and safety constraints. Searching is also supported with `/man search <words>`.",
    options: [
      { opt: "<command>", desc: "Displays manual for the given command (e.g. /man diff)" },
      { opt: "search <query>", desc: "Performs full-text keyword search across all manual pages" },
      { opt: "(none)", desc: "Lists all manual topics categorized by subsystem" }
    ],
    examples: [
      "/man",
      "/man status",
      "/man sandbox",
      "/man sound",
      "/man metrics",
      "/man search recovery"
    ],
    seeAlso: ["help", "commands", "getting-started"],
    aliases: ["manual", "doc", "docs"]
  },

  status: {
    name: "status",
    category: "core",
    synopsis: "/status",
    description: "Displays the real-time operational status of Miss Data. This includes the active LLM provider, selected model, current working directory, sandbox enforcement status, tool approval mode, output token budget, execution mode (plan vs direct), response language, memory facts count, active session ID, and files touched during the current turn.",
    examples: [
      "/status"
    ],
    safety: "Zero token cost. Reads local agent settings without querying external LLMs.",
    seeAlso: ["doctor", "budget", "metrics", "provider"],
    aliases: ["info", "whoami"]
  },

  doctor: {
    name: "doctor",
    category: "core",
    synopsis: "/doctor",
    description: "Runs an instant, comprehensive health check on your development workspace. It validates working directory accessibility, sandbox boundary enforcement, local git status, configured provider API keys, and Ollama local server loopback availability. It produces actionable diagnostic feedback completely free of model token costs.",
    examples: [
      "/doctor"
    ],
    safety: "Completely zero token cost. Performs only read-only local environment checks.",
    seeAlso: ["status", "resilience", "troubleshooting"],
    aliases: ["diag", "check", "health"]
  },

  logs: {
    name: "logs",
    category: "core",
    synopsis: "/logs [count]",
    description: "Inspects Miss Data's in-memory activity logs. Captures recent tool invocations, approvals, file access events, and provider responses. Sensitive API keys and tokens are automatically redacted with cryptographic masks to prevent secret leakage.",
    options: [
      { opt: "[count]", desc: "Number of recent events to display (default: 5)" }
    ],
    examples: [
      "/logs",
      "/logs 10"
    ],
    safety: "Secrets and credentials in tool arguments are masked before writing to log buffers.",
    seeAlso: ["privacy", "doctor"],
    aliases: ["log", "history-log"]
  },

  // ==========================================
  // 2. CODEBASE & WORKSPACE
  // ==========================================
  map: {
    name: "map",
    category: "workspace",
    synopsis: "/map [depth]",
    description: "Analyzes the current repository to produce an onboarding architectural map. Automatically scans directory trees, identifies project frameworks (e.g. Vite, React, Express, Node.js), locates build/package manifests (`package.json`, `tsconfig.json`), and discovers runnable test commands. Ideal when first loading an unfamiliar project.",
    options: [
      { opt: "[depth]", desc: "Maximum directory depth to explore (default: 3)" }
    ],
    examples: [
      "/map",
      "/map 2"
    ],
    safety: "Zero model tokens. Runs locally on the filesystem within sandbox constraints.",
    seeAlso: ["test", "cwd", "doctor"],
    aliases: ["explore", "tree", "structure"]
  },

  changes: {
    name: "changes",
    category: "workspace",
    synopsis: "/changes",
    description: "Lists all files created, modified, or written during the active session turns. Helps you keep track of what code Miss Data has altered during the current prompt lifecycle before committing.",
    examples: [
      "/changes"
    ],
    seeAlso: ["diff", "discard", "checkpoint", "git"],
    aliases: ["modified", "touched"]
  },

  diff: {
    name: "diff",
    category: "workspace",
    synopsis: "/diff [revision | file]",
    description: "Inspects a bounded unified diff of modifications made to your workspace files. If working inside a Git repository, it displays `git diff` against the working tree or target revision. If untracked files exist, it summarizes altered paths with line counts.",
    options: [
      { opt: "[revision]", desc: "Git commit hash or branch to diff against (e.g. HEAD~1)" },
      { opt: "[file]", desc: "Specific filename or path to inspect" }
    ],
    examples: [
      "/diff",
      "/diff HEAD~1",
      "/diff src/components/Terminal.tsx"
    ],
    seeAlso: ["changes", "git", "discard"],
    aliases: ["patch"]
  },

  cwd: {
    name: "cwd",
    category: "workspace",
    synopsis: "/cwd [path]",
    description: "Displays or switches Miss Data's active working directory. All relative paths for file reading, file editing, and sandboxed commands resolve against this directory.",
    options: [
      { opt: "[path]", desc: "Target directory path to navigate to (relative or absolute)" },
      { opt: "(none)", desc: "Prints the current working directory path" }
    ],
    examples: [
      "/cwd",
      "/cwd ./src",
      "/cwd .."
    ],
    safety: "If sandbox mode is active, `/cwd` restricts navigation within allowed workspace boundaries.",
    seeAlso: ["sandbox", "status", "pwd"],
    aliases: ["cd", "dir"]
  },

  test: {
    name: "test",
    category: "workspace",
    synopsis: "/test [run <index> | <command>]",
    description: "Discovers and executes automated tests. Without arguments, `/test` inspects manifests (`package.json`, test scripts) to identify existing test suites. With `run <index>`, it executes the selected test suite through the sandbox with real-time exit code reporting.",
    options: [
      { opt: "(none)", desc: "Lists all discovered test commands with numbered indexes" },
      { opt: "run <index>", desc: "Executes the test command matching the number index" }
    ],
    examples: [
      "/test",
      "/test run 1",
      "/test run 2"
    ],
    safety: "Executing tests runs shell commands. Commands requiring write/network privileges trigger approval prompts when approval mode is set to 'risky' or 'always'.",
    seeAlso: ["map", "run"],
    aliases: ["tests", "suite"]
  },

  run: {
    name: "run",
    category: "workspace",
    synopsis: "/run <command>  |  $<command>",
    description: "Executes a shell command directly inside the sandbox environment. Output (stdout/stderr) and exit status codes are captured and displayed in the terminal. You can also use the shorthand `$ <command>` or `/exec`.",
    options: [
      { opt: "<command>", desc: "Shell command string to execute (e.g. `ls -la`, `npm test`)" }
    ],
    examples: [
      "/run ls -la",
      "/run git status",
      "/run npm run lint",
      "$ git log -n 3"
    ],
    safety: "Destructive commands (e.g. `rm -rf /`, `mkfs`, raw disk writes) are strictly blocked by the sandbox. Risky actions trigger user confirmation based on `/approval` mode.",
    seeAlso: ["sandbox", "approval", "git"],
    aliases: ["exec", "sh", "bash", "$"]
  },

  // ==========================================
  // 3. CONFIGURATION & BUDGET
  // ==========================================
  budget: {
    name: "budget",
    category: "config",
    synopsis: "/budget [economy | balanced | thorough | <tokens>]",
    description: "Controls the maximum output token limit (`maxOutputTokens`) for model completions. Setting an appropriate budget prevents runaway token costs and keeps responses concise or detailed based on task requirements.",
    options: [
      { opt: "economy", desc: "Caps output at 768 tokens (fastest, lowest cost, concise code)" },
      { opt: "balanced", desc: "Caps output at 2048 tokens (standard engineering workflow)" },
      { opt: "thorough", desc: "Caps output at 4096 tokens (large code refactoring, detailed docs)" },
      { opt: "<tokens>", desc: "Explicit integer token cap between 128 and 16384" }
    ],
    examples: [
      "/budget",
      "/budget economy",
      "/budget balanced",
      "/budget thorough",
      "/budget 1024"
    ],
    seeAlso: ["status", "context", "provider"],
    aliases: ["tokens", "limit"]
  },

  provider: {
    name: "provider",
    category: "config",
    synopsis: "/provider [name]",
    description: "Switches the active LLM provider backend. Supports Google Gemini, Groq, Anthropic Claude, OpenAI, DeepSeek, OpenRouter, Mistral, Together, Ollama, and custom OpenAI-compatible endpoints.",
    options: [
      { opt: "gemini", desc: "Google Gemini (default: gemini-2.5-flash)" },
      { opt: "groq", desc: "Groq ultra-fast LPU inference (e.g. Llama 3.3 70B)" },
      { opt: "anthropic", desc: "Anthropic Claude (e.g. claude-3-7-sonnet)" },
      { opt: "ollama", desc: "Local offline Ollama server (loopback localhost:11434)" },
      { opt: "openai", desc: "OpenAI GPT models (gpt-4o, gpt-4o-mini)" },
      { opt: "deepseek", desc: "DeepSeek models (deepseek-chat, deepseek-coder)" },
      { opt: "openrouter", desc: "OpenRouter unified API gateway" }
    ],
    examples: [
      "/provider",
      "/provider gemini",
      "/provider groq",
      "/provider ollama"
    ],
    safety: "Changing providers initiates a clean turn state to prevent message format conflicts across different provider APIs.",
    seeAlso: ["model", "keys", "status"],
    aliases: ["backend", "engine"]
  },

  model: {
    name: "model",
    category: "config",
    synopsis: "/model [model-identifier]",
    description: "Sets or queries the specific model identifier for the currently active provider. For instance, switch between `gemini-2.5-flash` and `gemini-2.5-pro` on Gemini, or `llama-3.3-70b-versatile` on Groq.",
    options: [
      { opt: "[model-identifier]", desc: "Model string (e.g. gemini-2.5-flash, gpt-4o, qwen2.5-coder)" },
      { opt: "(none)", desc: "Prints the currently selected model" }
    ],
    examples: [
      "/model",
      "/model gemini-2.5-flash",
      "/model gemini-2.5-pro",
      "/model llama-3.3-70b-versatile"
    ],
    seeAlso: ["provider", "budget", "status"],
    aliases: ["llm"]
  },

  mode: {
    name: "mode",
    category: "config",
    synopsis: "/mode [plan | direct]",
    description: "Toggles execution methodology between 'plan' (architectural planning first) and 'direct' (immediate tool execution). In 'plan' mode, Miss Data will first generate an implementation plan before performing file modifications, ensuring architectural clarity on complex tasks.",
    options: [
      { opt: "plan", desc: "Requires generating an implementation plan before tools execute" },
      { opt: "direct", desc: "Executes tools directly as required by the prompt" }
    ],
    examples: [
      "/mode",
      "/mode plan",
      "/mode direct"
    ],
    seeAlso: ["status", "approval"],
    aliases: ["planning", "exec-mode"]
  },

  lang: {
    name: "lang",
    category: "config",
    synopsis: "/lang [en | fa]",
    description: "Switches Miss Data's conversational and reporting response language between English and Persian (فارسی). You can also click the language toggle pill in the terminal header bar.",
    options: [
      { opt: "en", desc: "English language responses" },
      { opt: "fa", desc: "Persian (فارسی) language responses with localized terminology" }
    ],
    examples: [
      "/lang",
      "/lang en",
      "/lang fa"
    ],
    seeAlso: ["status"],
    aliases: ["language", "zaban"]
  },

  context: {
    name: "context",
    category: "config",
    synopsis: "/context",
    description: "Measures and reports the current conversation context length. Displays exact character counts, approximate token consumption (~4 characters per token), and comparison against your configured budget cap.",
    examples: [
      "/context"
    ],
    safety: "Zero token cost calculation.",
    seeAlso: ["budget", "compact", "clear"],
    aliases: ["tokens-used", "meter"]
  },

  // ==========================================
  // 4. SECURITY & SAFEGUARDS
  // ==========================================
  approval: {
    name: "approval",
    category: "safeguards",
    synopsis: "/approval [always | risky | auto]",
    description: "Sets the human-in-the-loop tool execution safeguard policy. Dictates when Miss Data must pause and ask for explicit user approval before executing tools like writing files or executing shell commands.",
    options: [
      { opt: "risky", desc: "Default policy. Prompts approval for state-changing or risky actions (file overwrite, git reset, shell commands). Read-only actions pass automatically." },
      { opt: "always", desc: "Maximum security. Prompts approval for every single tool invocation, including read-only file inspections." },
      { opt: "auto", desc: "Autonomous mode. Executes all tools within sandbox boundaries without manual approval prompts." }
    ],
    examples: [
      "/approval",
      "/approval risky",
      "/approval always",
      "/approval auto"
    ],
    safety: "When an approval is requested, type 'y' to approve once, 'a' to always approve this tool type, or 'n' to reject.",
    seeAlso: ["sandbox", "status", "safety"],
    aliases: ["permission", "safeguard", "confirm"]
  },

  sandbox: {
    name: "sandbox",
    category: "safeguards",
    synopsis: "/sandbox [on | off]",
    description: "Enforces strict local filesystem and process boundaries. When enabled, tool file reads and edits are strictly confined to the active working directory, and dangerous destructive commands (such as fork bombs, root formatting, or system partition modification) are automatically blocked.",
    options: [
      { opt: "on", desc: "Enables filesystem confinement and command filter" },
      { opt: "off", desc: "⚠️ Disables sandbox boundary enforcement (use with caution)" }
    ],
    examples: [
      "/sandbox",
      "/sandbox on",
      "/sandbox off"
    ],
    safety: "Keep sandbox enabled during normal development to protect host filesystem integrity.",
    seeAlso: ["approval", "cwd", "safety"],
    aliases: ["jail", "containment"]
  },

  privacy: {
    name: "privacy",
    category: "safeguards",
    synopsis: "/privacy [clear <logs | sessions | history | all>]",
    description: "Displays paths of all stored local files (command history, session databases, activity logs) and offers targeted or full scrub capabilities to wipe traces before repository export or when working on shared devices.",
    options: [
      { opt: "(none)", desc: "Displays stored files, session counts, and privacy status" },
      { opt: "clear logs", desc: "Wipes in-memory and persisted activity log buffers" },
      { opt: "clear sessions", desc: "Deletes stored chat session transcripts" },
      { opt: "clear history", desc: "Clears saved command line history" },
      { opt: "clear all", desc: "Performs complete purge of all local logs, sessions, and history" }
    ],
    examples: [
      "/privacy",
      "/privacy clear logs",
      "/privacy clear all"
    ],
    safety: "Clearing data is permanent and irreversible.",
    seeAlso: ["logs", "clear"],
    aliases: ["clean", "purge", "scrub"]
  },

  // ==========================================
  // 5. VERSION CONTROL & RECOVERY
  // ==========================================
  git: {
    name: "git",
    category: "vcs",
    synopsis: "/git <subcommand>  |  git <subcommand>",
    description: "Direct wrapper around Git version control within your workspace. Run `git status`, `git diff`, `git log`, `git commit`, `git branch`, and any other standard Git operations directly from the terminal prompt.",
    options: [
      { opt: "status", desc: "Show modified, untracked, and staged files" },
      { opt: "diff", desc: "Show unified differences in working tree" },
      { opt: "log", desc: "Show recent commit history" },
      { opt: "branch", desc: "List or manage branches" }
    ],
    examples: [
      "/git status",
      "/git diff",
      "/git log -n 5",
      "git branch -a",
      "git status -s"
    ],
    seeAlso: ["diff", "changes", "checkpoint", "update", "discard"],
    aliases: ["vcs"]
  },

  checkpoint: {
    name: "checkpoint",
    category: "vcs",
    synopsis: "/checkpoint [name]",
    description: "Creates an instant local snapshot of all modified workspace files. Checkpoints allow you to bookmark your code before large refactors or risky experiments, providing a safe point to restore if needed.",
    options: [
      { opt: "[name]", desc: "Descriptive label for the snapshot (default: timestamped tag)" }
    ],
    examples: [
      "/checkpoint",
      "/checkpoint before-database-migration",
      "/checkpoint working-state-v1"
    ],
    seeAlso: ["checkpoints", "restore", "git"],
    aliases: ["snapshot", "savepoint", "tag"]
  },

  checkpoints: {
    name: "checkpoints",
    category: "vcs",
    synopsis: "/checkpoints",
    description: "Lists all saved checkpoints in the current session with their creation timestamps, names, and internal identifiers.",
    examples: [
      "/checkpoints"
    ],
    seeAlso: ["checkpoint", "restore"],
    aliases: ["snapshots"]
  },

  restore: {
    name: "restore",
    category: "vcs",
    synopsis: "/restore <checkpoint-name-or-id>",
    description: "Restores workspace files to the state captured in a previous checkpoint. Overwrites changes made since that checkpoint was taken.",
    options: [
      { opt: "<checkpoint>", desc: "Checkpoint name or unique snapshot identifier to roll back to" }
    ],
    examples: [
      "/restore before-database-migration",
      "/restore cp-1718000000"
    ],
    safety: "Restoring can discard uncommitted changes made since the checkpoint. Confirm your current changes with `/diff` before restoring.",
    seeAlso: ["checkpoint", "checkpoints", "discard"],
    aliases: ["rollback", "revert"]
  },

  update: {
    name: "update",
    category: "vcs",
    synopsis: "/update [check | apply]",
    description: "Inspects or fast-forwards Miss Data from the official GitHub remote repository (https://github.com/RootedMani/Miss-Data.git). Running `/update check` verifies if newer commits exist without touching local files. Running `/update apply` cleanly pulls updates if the working tree is clean.",
    options: [
      { opt: "check", desc: "Checks remote repository for newer commits (read-only)" },
      { opt: "apply", desc: "Fast-forward updates repository to latest official remote branch" }
    ],
    examples: [
      "/update",
      "/update check",
      "/update apply"
    ],
    safety: "Requires a clean git working tree. If you have uncommitted changes, stash them with `git stash` or discard them with `/discard` before updating.",
    seeAlso: ["discard", "git"],
    aliases: ["upgrade", "sync"]
  },

  discard: {
    name: "discard",
    category: "vcs",
    synopsis: "/discard",
    description: "Discards all uncommitted working tree changes in the Git repository (`git restore . && git clean -fd`). Returns the codebase to the state of the last clean commit.",
    examples: [
      "/discard"
    ],
    safety: "⚠️ Highly destructive: permanently discards all unstaged local edits and removes untracked files.",
    seeAlso: ["diff", "changes", "update", "checkpoint"],
    aliases: ["reset-hard", "clean-tree"]
  },

  // ==========================================
  // 6. TERMINAL INTERFACE & AUDIO
  // ==========================================
  sound: {
    name: "sound",
    category: "interface",
    synopsis: "/sound [on | off | toggle]",
    description: "Configures the terminal's retro acoustic synthesizer. Built using the native Web Audio API, sound effects provide subtle tactile auditory feedback: mechanical keystroke taps on command submission, high-frequency harmonic clicks on Tab completions, warm success chimes on zero exit codes, and classic dual-tone alerts on command errors.",
    options: [
      { opt: "on", desc: "Enables audio feedback" },
      { opt: "off", desc: "Mutes all terminal audio effects" },
      { opt: "toggle", desc: "Toggles between sound enabled and muted" }
    ],
    examples: [
      "/sound",
      "/sound on",
      "/sound off",
      "/sound toggle"
    ],
    seeAlso: ["metrics", "clear"],
    aliases: ["audio", "fx", "mute"]
  },

  metrics: {
    name: "metrics",
    category: "interface",
    synopsis: "/metrics [on | off | toggle]  |  /statusline [on | off]",
    description: "Toggles the non-intrusive system status line at the bottom of the terminal window. Displays real-time Node.js heap memory usage (`heapUsed / heapTotal`), Resident Set Size (`RSS`), round-trip API ping latency (`PING: X ms`), and process uptime (`UP: X`). Also toggleable via the header **Sys** button, the bottom tmux-bar `metrics: on/off` toggle, or the `[hide ×]` button.",
    options: [
      { opt: "on", desc: "Displays the bottom memory and latency status line" },
      { opt: "off", desc: "Hides the status line completely" },
      { opt: "toggle", desc: "Switches visibility state" }
    ],
    examples: [
      "/metrics",
      "/metrics on",
      "/metrics off",
      "/statusline off"
    ],
    seeAlso: ["status", "sound"],
    aliases: ["statusline", "sys", "latency", "ram"]
  },

  clear: {
    name: "clear",
    category: "interface",
    synopsis: "clear  |  /clear  |  Ctrl+L",
    description: "Clears the active terminal scrollback display buffer. Resetting the screen provides a fresh workspace without deleting durable memory facts or active session state. Can be invoked with standard `clear`, `/clear`, pressing `Ctrl+L` (`Cmd+L`), or clicking the `^L` button in the header bar.",
    examples: [
      "clear",
      "/clear"
    ],
    seeAlso: ["compact", "privacy"],
    aliases: ["cls", "reset"]
  },

  autocomplete: {
    name: "autocomplete",
    category: "interface",
    synopsis: "Type commands or prompts; press Tab or Right Arrow (→) to accept",
    description: "Miss Data features real-time dual-layer autocompletion inspired by Google AI Studio:\n1. Ghost Inline Completion: Displays subtle, italicized inline ghost suggestions for common prompts, slash commands, and file paths. Press `Tab` or `→` to accept the ghost suggestion.\n2. Interactive Slash Command Dropdown: As soon as you type `/`, an interactive popup surfaces all matching slash commands with descriptions. Navigate with `↑` and `↓` arrow keys, and press `Tab` or `Enter` to select.\n3. History Cycling: Use `↑` and `↓` on an empty or partial input to recall previous commands.",
    examples: [
      "Type 'how to' -> see ghost suggestion -> press Tab",
      "Type '/' -> browse popup dropdown -> select command",
      "Press Up Arrow (↑) to cycle through command history"
    ],
    seeAlso: ["help", "man"],
    aliases: ["ghost", "tab-complete", "suggestions"]
  },

  // ==========================================
  // 7. MEMORY & SESSIONS
  // ==========================================
  memory: {
    name: "memory",
    category: "memory",
    synopsis: "/memory",
    description: "Displays durable facts that Miss Data has remembered across sessions. Unlike regular conversational turns which may be cleared or compacted, remembered facts persist indefinitely, storing critical architecture decisions, preferred coding standards, and user preferences.",
    examples: [
      "/memory"
    ],
    seeAlso: ["forget", "compact", "sessions"],
    aliases: ["facts", "remembered"]
  },

  forget: {
    name: "forget",
    category: "memory",
    synopsis: "/forget <fact-number>",
    description: "Deletes a specific durable memory fact by its numeric index (obtained from `/memory`).",
    options: [
      { opt: "<fact-number>", desc: "Numeric ID of the fact to remove" }
    ],
    examples: [
      "/forget 1",
      "/forget 3"
    ],
    safety: "Permanently deletes the fact from the durable store.",
    seeAlso: ["memory", "privacy"],
    aliases: ["remove-fact", "delete-fact"]
  },

  compact: {
    name: "compact",
    category: "memory",
    synopsis: "/compact [keep-turns]",
    description: "Condenses older conversation turns into a succinct architectural summary note while preserving the most recent turns intact. This frees up model token context window space without losing critical context from earlier in the session.",
    options: [
      { opt: "[keep-turns]", desc: "Number of recent turns to preserve uncompacted (default: 4)" }
    ],
    examples: [
      "/compact",
      "/compact 2",
      "/compact 6"
    ],
    seeAlso: ["context", "clear", "budget"],
    aliases: ["summarize", "shrink-context"]
  },

  sessions: {
    name: "sessions",
    category: "memory",
    synopsis: "/sessions",
    description: "Lists all locally stored conversation sessions with their identifiers, titles, and message counts. Allows resuming prior conversations or inspecting historical engineering workflows.",
    examples: [
      "/sessions"
    ],
    seeAlso: ["memory", "privacy"],
    aliases: ["conversations", "threads"]
  },

  resilience: {
    name: "resilience",
    category: "memory",
    synopsis: "/resilience",
    description: "Configures automatic failover and error recovery strategies. When active, if a provider encounters rate limits or quota depletion, Miss Data automatically rotates through available keys and configured fallback providers. It also handles context window overflow by automatically compacting history.",
    examples: [
      "/resilience"
    ],
    seeAlso: ["doctor", "provider", "keys"],
    aliases: ["recovery", "failover", "fallback"]
  },

  keys: {
    name: "keys",
    category: "memory",
    synopsis: "/keys [show | add | remove] [provider]",
    description: "Manages API key pools for configured providers. Supports multi-key rotation to seamlessly navigate per-key rate limits. Keys are stored securely and masked in logs.",
    options: [
      { opt: "show [provider]", desc: "Shows configured providers with masked key previews" },
      { opt: "add <provider> <key>", desc: "Adds an API key to the provider's rotation pool" },
      { opt: "remove <provider>", desc: "Removes configured key for provider" }
    ],
    examples: [
      "/keys show",
      "/keys show groq",
      "/keys add gemini AIzaSy..."
    ],
    safety: "Never exposes full API keys in unmasked format. Sensitive values are excluded from command logs.",
    seeAlso: ["provider", "doctor", "privacy"],
    aliases: ["api-keys", "credentials"]
  },

  // ==========================================
  // 8. SYSTEM UTILITIES
  // ==========================================
  ls: {
    name: "ls",
    category: "utilities",
    synopsis: "ls [flags] [directory]",
    description: "Lists directory contents in the active workspace. Supports standard flags such as `-la` to reveal hidden configuration files, permissions, sizes, and last modified dates.",
    options: [
      { opt: "-l", desc: "Use long listing format with sizes and modification times" },
      { opt: "-a", desc: "Include directory entries starting with '.' (hidden files)" },
      { opt: "-h", desc: "Print human-readable file sizes (e.g. 1K, 234M)" }
    ],
    examples: [
      "ls",
      "ls -la",
      "ls src",
      "ls -lh dist"
    ],
    seeAlso: ["pwd", "find", "cat"],
    aliases: ["dir", "list"]
  },

  pwd: {
    name: "pwd",
    category: "utilities",
    synopsis: "pwd",
    description: "Prints the absolute path of the current working directory.",
    examples: [
      "pwd"
    ],
    seeAlso: ["cwd", "ls"],
    aliases: []
  },

  whoami: {
    name: "whoami",
    category: "utilities",
    synopsis: "whoami",
    description: "Displays the current user and agent identity along with active environment privileges.",
    examples: [
      "whoami"
    ],
    seeAlso: ["status"],
    aliases: []
  },

  cat: {
    name: "cat",
    category: "utilities",
    synopsis: "cat <file-path>",
    description: "Displays the contents of a text file in the terminal buffer. Confined to sandbox path boundaries.",
    options: [
      { opt: "<file-path>", desc: "Path to the text file to read" }
    ],
    examples: [
      "cat package.json",
      "cat metadata.json",
      "cat src/main.tsx"
    ],
    seeAlso: ["grep", "ls"],
    aliases: ["view", "read"]
  },

  grep: {
    name: "grep",
    category: "utilities",
    synopsis: "grep [flags] <pattern> [files]",
    description: "Searches for matching regex or string patterns across files in the workspace.",
    options: [
      { opt: "-r", desc: "Recursively search subdirectories" },
      { opt: "-i", desc: "Ignore case distinctions in patterns" },
      { opt: "-n", desc: "Prefix each line of output with its 1-based line number" }
    ],
    examples: [
      "grep -rn 'handleSendMessage' src/",
      "grep -i 'gemini' server/",
      "grep 'version' package.json"
    ],
    seeAlso: ["find", "cat"],
    aliases: ["search"]
  },

  find: {
    name: "find",
    category: "utilities",
    synopsis: "find [path] -name <pattern>",
    description: "Locates files within the workspace matching a file name pattern.",
    options: [
      { opt: "-name <pattern>", desc: "File name or glob pattern (e.g. '*.tsx', '*.json')" },
      { opt: "-type f|d", desc: "Filter by file (f) or directory (d)" }
    ],
    examples: [
      "find . -name '*.tsx'",
      "find src/ -name 'Terminal*'",
      "find . -name 'package.json'"
    ],
    seeAlso: ["ls", "grep"],
    aliases: ["locate"]
  },

  npm: {
    name: "npm",
    category: "utilities",
    synopsis: "npm <command> [args]",
    description: "Executes Node Package Manager operations within the project container. Common commands include running build pipelines, linting, testing, and dependency audits.",
    options: [
      { opt: "run build", desc: "Executes the production build pipeline" },
      { opt: "run lint", desc: "Runs TypeScript syntax and type checkers" },
      { opt: "test", desc: "Executes configured test runner" }
    ],
    examples: [
      "npm run build",
      "npm run lint",
      "npm test"
    ],
    safety: "Installing arbitrary external packages without review is restricted. Use pre-installed packages where possible.",
    seeAlso: ["node", "run", "test"],
    aliases: []
  },

  node: {
    name: "node",
    category: "utilities",
    synopsis: "node [flags] [script | -e 'code']",
    description: "Runs Node.js scripts or inline JavaScript/TypeScript snippets in the local runtime.",
    options: [
      { opt: "-e 'code'", desc: "Evaluates inline JavaScript snippet directly" },
      { opt: "-v", desc: "Prints Node.js runtime version" }
    ],
    examples: [
      "node -v",
      "node -e \"console.log(process.version)\"",
      "node -e \"console.log(process.memoryUsage())\""
    ],
    seeAlso: ["npm", "run"],
    aliases: []
  },

  // ==========================================
  // 9. ARCHITECTURE & CONCEPTS
  // ==========================================
  architecture: {
    name: "architecture",
    category: "guides",
    synopsis: "Architecture & System Design of Miss Data",
    description: "Miss Data is architected with a decoupled full-stack design:\n- Client (React 18 + Vite + Tailwind CSS): Renders the terminal emulator with xterm styling, real-time Web Audio sound effects, ghost prompt autocompletion, statusline telemetry, and font controls.\n- Server (Express + TypeScript): Hosts the core AgentService orchestrator, Sandbox executor, Git wrapper, and REST endpoints for chat, autocompletions, and manual lookups.\n- Zero-Cost Local Tools: Diagnostics, test discovery, and file searches run locally without consuming model tokens.\n- LLM Engine: Connects to Google Gemini via the official `@google/genai` SDK with multi-provider fallbacks and human-in-the-loop safeguards.",
    examples: [
      "/status",
      "/doctor",
      "/man overview",
      "/man safety"
    ],
    seeAlso: ["overview", "safety", "workflows"],
    aliases: ["design", "internals"]
  },

  workflows: {
    name: "workflows",
    category: "guides",
    synopsis: "Best practice engineering workflows with Miss Data",
    description: "Recommended development cycle:\n1. Orient: Run `/doctor` and `/map` to inspect the project without spending tokens.\n2. Plan: Use `/mode plan` for architectural tasks to see proposed file changes before writing.\n3. Implement: Give concise prompts. Miss Data reads files, creates backups, and modifies code surgically.\n4. Verify: Run `/changes` and `/diff` to inspect modified files, then test with `/test run 1` or `npm run lint`.\n5. Bookmark: Run `/checkpoint <tag>` to preserve working milestones.",
    examples: [
      "/map",
      "/mode plan",
      "/changes",
      "/diff",
      "/checkpoint v1"
    ],
    seeAlso: ["getting-started", "architecture", "map", "test"],
    aliases: ["practices", "cycle"]
  },

  safety: {
    name: "safety",
    category: "guides",
    synopsis: "Safety layers, sandboxing, and approval policies",
    description: "Miss Data enforces multi-tiered security safeguards:\n1. Path Confinement: All file tools are bounded by the active workspace directory.\n2. Command Filtering: Fork bombs, raw disk writes, and root modifications are blocked.\n3. Human-in-the-Loop Approvals: State-changing tools prompt for user approval ('y' approve, 'a' always, 'n' reject) according to `/approval` policy.\n4. Secret Masking: API keys and credentials are never logged in plaintext.\n5. Non-Destructive Fallbacks: File edits create in-memory touch records to enable easy diffing and rollback.",
    examples: [
      "/approval risky",
      "/sandbox on",
      "/privacy"
    ],
    seeAlso: ["approval", "sandbox", "privacy"],
    aliases: ["security", "safeguards"]
  },

  troubleshooting: {
    name: "troubleshooting",
    category: "guides",
    synopsis: "Resolving common issues, rate limits, and network errors",
    description: "Quick troubleshooting recipes:\n- Error Communicating with LLM: Check `/doctor` to confirm API keys. Use `/provider` to switch to an available provider or local Ollama.\n- Context Limit Reached: Run `/compact` to shrink previous turns into an executive summary, or `/clear` to start fresh.\n- Git Merge or Update Conflict: Run `/discard` to reset uncommitted local files, or `/diff` to examine conflicts.\n- Unwanted Changes: Check `/changes` or restore from a previous milestone using `/restore <checkpoint>`.",
    examples: [
      "/doctor",
      "/compact",
      "/diff",
      "/discard"
    ],
    seeAlso: ["doctor", "resilience", "update"],
    aliases: ["debug", "faq", "fixes"]
  }
};

/**
 * Searches manuals by keyword across name, synopsis, description, and aliases.
 */
export function searchManual(query: string): ManualPage[] {
  const q = query.toLowerCase().trim();
  if (!q) return Object.values(MANUAL_PAGES);
  return Object.values(MANUAL_PAGES).filter(page => 
    page.name.toLowerCase().includes(q) ||
    page.synopsis.toLowerCase().includes(q) ||
    page.description.toLowerCase().includes(q) ||
    (page.category && page.category.toLowerCase().includes(q)) ||
    (page.aliases && page.aliases.some(a => a.toLowerCase().includes(q)))
  );
}

/**
 * Resolves a manual page by query (handles leading slashes, aliases, and direct names).
 */
export function getManualPage(query: string): ManualPage | null {
  const clean = query.trim().replace(/^\//, '').toLowerCase();
  if (!clean) return null;

  // Direct key lookup
  if (MANUAL_PAGES[clean]) {
    return MANUAL_PAGES[clean];
  }

  // Lookup by name or alias
  for (const page of Object.values(MANUAL_PAGES)) {
    if (page.name.toLowerCase() === clean) return page;
    if (page.aliases && page.aliases.some(a => a.toLowerCase() === clean)) {
      return page;
    }
  }

  // Fuzzy match on prefix
  for (const [key, page] of Object.entries(MANUAL_PAGES)) {
    if (key.startsWith(clean) || page.name.toLowerCase().startsWith(clean)) {
      return page;
    }
  }

  return null;
}

/**
 * Formats a manual page in authentic Unix man(1) markdown style.
 */
export function formatManualPage(page: ManualPage): string {
  const sections: string[] = [];

  // Header banner
  sections.push(`# 📖 MISS-DATA MANUAL: ${page.name.toUpperCase()}(1)`);

  // Synopsis
  sections.push(`### 📌 SYNOPSIS\n\`\`\`bash\n${page.synopsis}\n\`\`\``);

  // Description
  sections.push(`### 📝 DESCRIPTION\n${page.description}`);

  // Options if present
  if (page.options && page.options.length > 0) {
    const optsStr = page.options
      .map(o => `- **\`${o.opt}\`**: ${o.desc}`)
      .join('\n');
    sections.push(`### ⚙️ OPTIONS & ARGUMENTS\n${optsStr}`);
  }

  // Examples
  if (page.examples && page.examples.length > 0) {
    const exStr = page.examples
      .map(e => `- \`${e}\``)
      .join('\n');
    sections.push(`### 💡 EXAMPLES\n${exStr}`);
  }

  // Safety
  if (page.safety) {
    sections.push(`### 🛡️ SAFETY & SAFEGUARDS\n⚠️ ${page.safety}`);
  }

  // See Also
  if (page.seeAlso && page.seeAlso.length > 0) {
    const seeStr = page.seeAlso
      .map(s => `\`/man ${s}\``)
      .join(' • ');
    sections.push(`### 🔗 SEE ALSO\n${seeStr}`);
  }

  return sections.join('\n\n');
}

/**
 * Generates the categorized master index of all manuals.
 */
export function listManualTopics(): string {
  const categories: Record<string, { label: string; pages: ManualPage[] }> = {
    core: { label: "CORE AGENT COMMANDS", pages: [] },
    workspace: { label: "CODEBASE & WORKSPACE", pages: [] },
    config: { label: "CONFIGURATION & BUDGET", pages: [] },
    safeguards: { label: "SECURITY & SAFEGUARDS", pages: [] },
    vcs: { label: "VERSION CONTROL & CHECKPOINTS", pages: [] },
    interface: { label: "TERMINAL INTERFACE & AUDIO", pages: [] },
    memory: { label: "DURABLE MEMORY & SESSIONS", pages: [] },
    utilities: { label: "SYSTEM & SHELL UTILITIES", pages: [] },
    guides: { label: "CONCEPTUAL GUIDES & ARCHITECTURE", pages: [] },
  };

  for (const page of Object.values(MANUAL_PAGES)) {
    const cat = categories[page.category] || categories.core;
    cat.pages.push(page);
  }

  const lines: string[] = [
    "# 📚 MISS DATA BUILT-IN MANUALS (خانم داده)",
    "Type `/man <topic>` to read detailed Unix-style documentation for any command, or `/man search <words>` to find matching topics.\n"
  ];

  for (const cat of Object.values(categories)) {
    if (cat.pages.length === 0) continue;
    lines.push(`### ${cat.label}`);
    for (const p of cat.pages) {
      lines.push(`- **\`/man ${p.name}\`** — \`${p.synopsis}\``);
    }
    lines.push("");
  }

  lines.push("💡 *Tip: You can also type `/help <command>` for a quick guide, or use Tab autocomplete on any `/man` topic!*");
  return lines.join('\n');
}
