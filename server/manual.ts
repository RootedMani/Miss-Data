export interface ManualPage {
  name: string;
  synopsis: string;
  description: string;
  examples: string[];
  safety?: string;
  aliases?: string[];
}

export const MANUAL_PAGES: Record<string, ManualPage> = {
  overview: {
    name: "missdata",
    synopsis: "missdata [options]",
    description: "Miss Data is a terminal coding assistant. Type a request in plain language, or use slash commands for local workflows. Start with `/status`, `/map`, or `/man getting-started`.",
    examples: ["/man workflows", "/help", "/status"],
  },
  "getting-started": {
    name: "getting-started",
    synopsis: "Type a request, then review the answer and file summary.",
    description: "Choose a working directory, confirm the provider/model in the banner, and ask a focused request. Use `/mode plan` when you want an implementation plan before tools can act. Use `/map` before working in an unfamiliar repository.",
    examples: ["/map", "/mode plan", "Add tests for the parser and run the suggested test command."],
    aliases: ["start", "begin", "basics"],
  },
  commands: {
    name: "commands",
    synopsis: "/help [topic]  |  /man [topic]  |  /man search <words>",
    description: "`/help` is a compact command index. `/help <topic>` and `/man <topic>` open a focused guide. Use `/man search backup` to find related pages. Important topic names: getting-started, providers, keys, resilience, workflows, sessions, safety, privacy, update, and troubleshooting.",
    examples: ["/man keys", "/man search ollama", "/help workflows"],
    aliases: ["help", "manual"],
  },
  providers: {
    name: "providers",
    synopsis: "/provider <name>  |  /model <name>  |  /profile <name>",
    description: "Switch among configured remote providers (Groq, Anthropic, Gemini, DeepSeek, OpenAI, etc.) and local Ollama. Provider switches reset the conversation because message formats differ. `/profile explore|build|review` adjusts output budget and plan/direct behavior.",
    examples: ["/provider gemini", "/provider groq", "/model llama-3.3-70b-versatile", "/profile explore"],
    safety: "Changing company/provider is always explicit. Configure a provider key before requesting it.",
    aliases: ["model", "budget", "profile"],
  },
  keys: {
    name: "keys",
    synopsis: "/keys [show|add|replace|edit|remove] <provider>",
    description: "Manage ordered API-key pools. Failed or limited keys can rotate automatically. Default key display is masked; reveal requires another confirmation. Active-provider key edits refresh immediately.",
    examples: ["/keys show groq", "/keys add groq", "/keys edit groq 2", "/keys remove groq 1"],
    safety: "Full-key display can expose credentials in terminal scrollback. Key values are never written to activity logs.",
    aliases: ["api", "api-key", "credentials", "fallback"],
  },
  resilience: {
    name: "resilience",
    synopsis: "/fallback  |  /context-recovery <ask|auto|off>  |  /ollama-recovery <ask|auto|off>",
    description: "Miss Data rotates same-provider keys before offering another configured provider. Context-limit errors can compact older history and retry. Local Ollama connection or missing-model failures can start a local server or pull the configured model after permission.",
    examples: ["/fallback set groq,gemini", "/context-recovery auto", "/ollama-recovery ask"],
    safety: "Cross-provider changes ask first. Ollama repair only targets loopback endpoints and does not use a shell.",
    aliases: ["rate-limit", "compact", "ollama", "errors"],
  },
  workflows: {
    name: "workflows",
    synopsis: "/map  |  /test [run N]  |  /context  |  /mode plan  |  /review [path]",
    description: "Use no-model-cost local commands to orient yourself before spending tokens. `/map` detects project structure and likely tests. `/test` suggests commands; running one goes through approvals. `/review` is model-backed but restricts tools to read-only inspection.",
    examples: ["/map", "/test", "/test run 1", "/review src"],
    aliases: ["map", "test", "review", "plan"],
  },
  git: {
    name: "git",
    synopsis: "/diff [revision]  |  /checkpoint [name]  |  /checkpoints  |  /restore <revision>",
    description: "Inspect a bounded diff, create a local checkpoint commit, list recent revisions, or restore a selected revision. These commands work inside a Git repository or local workspace checkpoints.",
    examples: ["/diff", "/checkpoint before-refactor", "/checkpoints", "/restore a1b2c3d"],
    safety: "Checkpoint stages all project changes. Restore performs a hard reset and can discard uncommitted work; both require confirmation.",
    aliases: ["diff", "checkpoint", "rollback", "restore"],
  },
  sessions: {
    name: "sessions",
    synopsis: "/sessions  |  /resume <id>  |  /new-session  |  /session-name <name>",
    description: "Completed conversations are stored locally for resume. List IDs, name the current session, start a new saved session, resume a prior conversation, or delete one selected session.",
    examples: ["/sessions", "/session-name parser cleanup", "/resume 12ab34cd56ef"],
    safety: "Session files contain conversation messages. Use `/privacy` to locate or delete them.",
    aliases: ["resume", "history", "conversation"],
  },
  safety: {
    name: "safety",
    synopsis: "/approval <always|risky|auto>  |  /sandbox <on|off>  |  Ctrl+C",
    description: "Approval policy controls when tool actions ask first. Sandbox confines file work to the selected working directory and blocks a focused set of destructive commands. Press Ctrl+C during generation to safely stop an incomplete model turn.",
    examples: ["/approval risky", "/sandbox on", "/cwd ./my-project"],
    safety: "Sandbox is a helpful local boundary, not a substitute for reviewing risky actions. Ctrl+C does not roll back a tool that already completed.",
    aliases: ["approval", "sandbox", "confinement", "stop"],
  },
  privacy: {
    name: "privacy",
    synopsis: "/privacy  |  /privacy clear <logs|sessions|history|all>",
    description: "Display local session, history, and log paths. Clean up saved state when working on shared devices or before repository exports. Each cleanup requires confirmation.",
    examples: ["/privacy", "/privacy clear logs", "/privacy clear all"],
    aliases: ["cleanup", "logs", "delete"],
  },
  update: {
    name: "update",
    synopsis: "/update [check|apply]  |  /discard",
    description: "Check the trusted Miss Data source checkout (https://github.com/RootedMani/Miss-Data.git) for updates. `apply` fast-forwards only after confirmation and requires a clean working tree.\n\nIf update stops with 'working tree has local changes', you can:\n1. Discard uncommitted changes: `git restore . && git clean -fd` (or use `/discard`)\n2. Reset divergent local commits: `git fetch origin && git reset --hard origin/main`\n3. Stash changes safely: `git stash -u` (restore later with `git stash pop`)",
    examples: [
      "/update",
      "/update check",
      "/update apply",
      "/discard",
      "git restore .",
      "git clean -fd",
      "git stash",
      "git reset --hard origin/main",
    ],
    safety: "Only the official trusted Git remote (https://github.com/RootedMani/Miss-Data.git) and a clean source tree are accepted.",
    aliases: ["upgrade", "discard", "stash"],
  },
  troubleshooting: {
    name: "troubleshooting",
    synopsis: "/doctor  |  /logs  |  /context-recovery auto",
    description: "Run diagnostics without spending tokens using `/doctor`. Review redacted activity logs with `/logs`. Check provider connection, key status, Ollama server, and context window limits.",
    examples: ["/doctor", "/logs", "/ollama-recovery ask"],
    aliases: ["doctor", "debug", "issues"],
  },
};

export function searchManual(query: string): ManualPage[] {
  const q = query.toLowerCase().trim();
  if (!q) return Object.values(MANUAL_PAGES);
  return Object.values(MANUAL_PAGES).filter(page => 
    page.name.toLowerCase().includes(q) ||
    page.synopsis.toLowerCase().includes(q) ||
    page.description.toLowerCase().includes(q) ||
    (page.aliases && page.aliases.some(a => a.toLowerCase().includes(q)))
  );
}
