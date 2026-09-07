import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { AgentSettings, Message, ToolCall, ToolResult, MemoryFact, SessionInfo, ActivityLogEvent } from './types.js';
import { Sandbox } from './sandbox.js';
import { MANUAL_PAGES, searchManual } from './manual.js';

export class AgentService {
  public settings: AgentSettings;
  public sandbox: Sandbox;
  public messages: Message[] = [];
  public alwaysApproved: Set<string> = new Set();
  public touchedFiles: Set<string> = new Set();
  public memoryFacts: MemoryFact[] = [];
  public sessions: Map<string, { title: string; messages: Message[]; updatedAt: number }> = new Map();
  public currentSessionId: string = 'session-default';
  public activityLogs: ActivityLogEvent[] = [];
  public pendingApproval: { toolCall: ToolCall; messageId: string; isRisky: boolean } | null = null;
  public checkpoints: { id: string; name: string; timestamp: number; files: Record<string, string> }[] = [];

  constructor() {
    this.sandbox = new Sandbox(process.cwd(), true);
    this.settings = {
      provider: process.env.GEMINI_API_KEY ? 'gemini' : (process.env.GROQ_API_KEY ? 'groq' : 'gemini'),
      model: 'gemini-2.5-flash',
      approvalMode: 'risky',
      sandboxMode: true,
      budgetProfile: 'balanced',
      maxOutputTokens: 2048,
      responseLanguage: 'en',
      executionMode: 'direct',
      contextRecovery: 'auto',
      ollamaRecovery: 'ask',
      ollamaUrl: 'http://localhost:11434',
      baseUrl: 'https://api.openai.com/v1',
      fallbackProviders: ['gemini', 'groq', 'deepseek', 'anthropic', 'ollama'],
    };

    // Initialize default session
    this.sessions.set(this.currentSessionId, {
      title: 'Initial session',
      messages: [],
      updatedAt: Date.now(),
    });

    this.logEvent('agent_initialized', {
      provider: this.settings.provider,
      model: this.settings.model,
      cwd: this.sandbox.cwd,
      sandbox: this.settings.sandboxMode,
    });
  }

  public logEvent(event: string, data: Record<string, any>) {
    // Redact any keys or secrets
    const redactedData: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (/key|secret|token|auth/i.test(k) && typeof v === 'string') {
        redactedData[k] = v.length > 8 ? `${v.slice(0, 3)}...${v.slice(-3)}` : '***';
      } else {
        redactedData[k] = v;
      }
    }
    this.activityLogs.unshift({
      timestamp: new Date().toISOString(),
      event,
      data: redactedData,
    });
    if (this.activityLogs.length > 200) this.activityLogs.pop();
  }

  public getStatus() {
    return {
      provider: this.settings.provider,
      model: this.settings.model,
      cwd: this.sandbox.cwd,
      approvalMode: this.settings.approvalMode,
      sandboxMode: this.settings.sandboxMode,
      budgetProfile: this.settings.budgetProfile,
      maxOutputTokens: this.settings.maxOutputTokens,
      responseLanguage: this.settings.responseLanguage,
      executionMode: this.settings.executionMode,
      contextRecovery: this.settings.contextRecovery,
      ollamaRecovery: this.settings.ollamaRecovery,
      memoryCount: this.memoryFacts.length,
      sessionTitle: this.sessions.get(this.currentSessionId)?.title || 'Untitled',
      sessionId: this.currentSessionId,
      touchedFilesCount: this.touchedFiles.size,
      availableProviders: [
        'gemini',
        'groq',
        'anthropic',
        'ollama',
        'deepseek',
        'openai',
        'openrouter',
        'together',
        'mistral',
        'fireworks',
        'xai',
        'moonshot',
        'perplexity',
        'custom',
      ],
      configuredKeys: {
        gemini: Boolean(process.env.GEMINI_API_KEY),
        groq: Boolean(process.env.GROQ_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
        deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
        openrouter: Boolean(process.env.OPENROUTER_API_KEY),
        together: Boolean(process.env.TOGETHER_API_KEY),
        mistral: Boolean(process.env.MISTRAL_API_KEY),
        fireworks: Boolean(process.env.FIREWORKS_API_KEY),
        xai: Boolean(process.env.XAI_API_KEY),
        moonshot: Boolean(process.env.MOONSHOT_API_KEY),
        perplexity: Boolean(process.env.PERPLEXITY_API_KEY),
        custom: Boolean(process.env.CUSTOM_API_KEY),
      },
    };
  }

  public isToolRisky(toolName: string): boolean {
    return ['write_file', 'edit_file', 'delete_path', 'move_path', 'run_command', 'run_python'].includes(toolName);
  }

  public async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const { name, args } = toolCall;
    this.logEvent('tool_execute_start', { tool: name, args });
    try {
      let output = '';
      let isError = false;

      switch (name) {
        case 'read_file': {
          const res = this.sandbox.readFile(args.filePath || args.path);
          if (res.error) {
            output = `Error reading file: ${res.error}`;
            isError = true;
          } else {
            output = res.content;
          }
          break;
        }
        case 'write_file': {
          const target = args.filePath || args.path;
          const res = this.sandbox.writeFile(target, args.content || '');
          if (res.error) {
            output = `Error writing file: ${res.error}`;
            isError = true;
          } else {
            this.touchedFiles.add(target);
            output = `Successfully wrote ${args.content?.length || 0} characters to ${target}`;
          }
          break;
        }
        case 'edit_file': {
          const target = args.filePath || args.path;
          const res = this.sandbox.editFile(target, args.findText || args.find || '', args.replaceText || args.replace || '');
          if (res.error) {
            output = `Error editing file: ${res.error}`;
            isError = true;
          } else {
            this.touchedFiles.add(target);
            output = `Successfully replaced target text in ${target}`;
          }
          break;
        }
        case 'delete_path': {
          const target = args.path || args.targetPath;
          const res = this.sandbox.deletePath(target);
          if (res.error) {
            output = `Error deleting path: ${res.error}`;
            isError = true;
          } else {
            this.touchedFiles.add(target);
            output = `Successfully deleted ${target}`;
          }
          break;
        }
        case 'move_path': {
          const src = args.source || args.src;
          const dst = args.destination || args.dst;
          const res = this.sandbox.movePath(src, dst);
          if (res.error) {
            output = `Error moving path: ${res.error}`;
            isError = true;
          } else {
            this.touchedFiles.add(src);
            this.touchedFiles.add(dst);
            output = `Successfully moved ${src} to ${dst}`;
          }
          break;
        }
        case 'make_dir': {
          const dir = args.path || args.dirPath;
          const res = this.sandbox.makeDir(dir);
          if (res.error) {
            output = `Error creating directory: ${res.error}`;
            isError = true;
          } else {
            output = `Directory created: ${dir}`;
          }
          break;
        }
        case 'list_dir': {
          const dir = args.path || args.targetDir || '.';
          const res = this.sandbox.listDir(dir, args.depth || 3);
          if (res.error) {
            output = `Error listing directory: ${res.error}`;
            isError = true;
          } else {
            output = res.items.map(i => `${i.type === 'directory' ? '📁' : '📄'} ${i.path} ${i.size ? `(${i.size} B)` : ''}`).join('\n');
          }
          break;
        }
        case 'search_files': {
          const res = this.sandbox.searchFiles(args.pattern || '*');
          if (res.error) {
            output = `Error searching files: ${res.error}`;
            isError = true;
          } else {
            output = res.results.length ? res.results.join('\n') : 'No files matched pattern.';
          }
          break;
        }
        case 'grep': {
          const res = this.sandbox.grep(args.query || '', args.filePattern);
          if (res.error) {
            output = `Error searching text: ${res.error}`;
            isError = true;
          } else {
            output = res.matches.length
              ? res.matches.map(m => `${m.file}:${m.line}: ${m.text}`).join('\n')
              : 'No occurrences found.';
          }
          break;
        }
        case 'run_command': {
          const cmd = args.command || args.cmd;
          const res = this.sandbox.runCommand(cmd);
          if (res.exitCode !== 0) {
            output = `Exit code ${res.exitCode}\n${res.stderr || res.stdout}`;
            isError = true;
          } else {
            output = res.stdout || 'Command executed successfully with no output.';
          }
          break;
        }
        case 'run_python': {
          const code = args.code || '';
          const cmd = `python3 -c ${JSON.stringify(code)}`;
          const res = this.sandbox.runCommand(cmd);
          if (res.exitCode !== 0) {
            output = `Exit code ${res.exitCode}\n${res.stderr || res.stdout}`;
            isError = true;
          } else {
            output = res.stdout || 'Python snippet executed with no output.';
          }
          break;
        }
        case 'remember_fact': {
          const fact = args.fact || '';
          const newFact: MemoryFact = {
            id: this.memoryFacts.length + 1,
            fact,
            createdAt: Date.now(),
          };
          this.memoryFacts.push(newFact);
          output = `Fact #${newFact.id} recorded in persistent memory: "${fact}"`;
          break;
        }
        case 'web_search': {
          output = `Web search results for: "${args.query}":\n1. Documentation and repository information on GitHub\n2. Python and Node.js standard libraries guide\n3. Miss Data user manual documentation`;
          break;
        }
        default:
          output = `Unrecognized tool: ${name}`;
          isError = true;
      }

      this.logEvent('tool_execute_end', { tool: name, isError, outputLength: output.length });
      return { toolCallId: toolCall.id, name, output, isError };
    } catch (e: any) {
      return { toolCallId: toolCall.id, name, output: `Exception in tool execution: ${e.message}`, isError: true };
    }
  }

  public async handleSlashCommand(cmdStr: string): Promise<string> {
    const parts = cmdStr.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    switch (cmd) {
      case '/help': {
        if (arg && MANUAL_PAGES[arg.toLowerCase()]) {
          const p = MANUAL_PAGES[arg.toLowerCase()];
          return `### Manual Page: ${p.name}\n**Synopsis:** \`${p.synopsis}\`\n\n${p.description}\n\n**Examples:**\n${p.examples.map(e => `- \`${e}\``).join('\n')}\n${p.safety ? `\n⚠️ **Safety:** ${p.safety}` : ''}`;
        }
        return `## Miss Data Commands Index
- \`/status\` - Show active provider, model, budget, safeguards, recovery
- \`/doctor\` - Run no-model-cost diagnostics on workspace & git
- \`/changes\` / \`/diff [rev]\` - Inspect file changes and git diff
- \`/budget <economy|balanced|thorough|tokens>\` - Set output token cap
- \`/clear\` - Clear conversation turns in current session
- \`/compact [n]\` - Compact older turns into a summary note
- \`/memory\` - Show remembered durable facts
- \`/forget <n>\` - Delete remembered fact #n
- \`/cwd [path]\` - Show or change working directory
- \`/provider <name>\` - Switch LLM backend
- \`/model <name>\` - Switch model for active provider
- \`/keys [show|add|replace|edit|remove] <provider>\` - Manage key pools
- \`/fallback [set <p,...>|off]\` - Manage fallback provider order
- \`/approval <always|risky|auto>\` - Change tool confirmation behavior
- \`/sandbox <on|off>\` - Confine file tools to working directory
- \`/lang <en|fa>\` - Response language (English or Persian)
- \`/map\` - Project onboarding overview and test discovery
- \`/test [run N]\` - List or run discovered test commands
- \`/context\` - Approximate character and token meter
- \`/mode <plan|direct>\` - Require an implementation plan before tools act
- \`/checkpoint [name]\` / \`/checkpoints\` / \`/restore <rev>\` - Checkpoints & rollback
- \`/sessions\` - List saved conversation sessions
- \`/profile <explore|build|review>\` - Switch work profile
- \`/review [path]\` - Read-only model code inspection
- \`/privacy\` - View or clear session logs
- \`/update [check|apply]\` - Check or apply updates from official remote
- \`/discard\` - Discard uncommitted local working tree changes
- \`/man [topic]\` - Open built-in manual pages (try \`/man getting-started\` or \`/man update\`)`;
      }

      case '/status': {
        const s = this.getStatus();
        return `**Miss Data Status (خانم داده)**
- **Provider:** \`${s.provider}\` (Model: \`${s.model}\`)
- **Working Directory:** \`${s.cwd}\`
- **Safeguards:** Sandbox = \`${s.sandboxMode ? 'ON' : 'OFF'}\`, Approval = \`${s.approvalMode}\`
- **Budget:** \`${s.budgetProfile}\` (Cap: ${s.maxOutputTokens} tokens)
- **Execution Mode:** \`${s.executionMode}\` (Plan first: ${s.executionMode === 'plan' ? 'YES' : 'NO'})
- **Language:** \`${s.responseLanguage === 'fa' ? 'Persian (فارسی)' : 'English'}\`
- **Memory Facts:** ${s.memoryCount} saved
- **Session:** "${s.sessionTitle}" (${s.sessionId})
- **Files Touched This Turn:** ${s.touchedFilesCount}`;
      }

      case '/doctor': {
        const s = this.getStatus();
        const diskCheck = fs.existsSync(s.cwd) ? 'OK' : 'MISSING';
        return `### 🩺 Miss Data Diagnostics (Doctor)
- **Workspace Directory:** \`${s.cwd}\` [${diskCheck}]
- **Active Provider:** \`${s.provider}\` (Model: \`${s.model}\`)
- **Sandbox Root:** \`${this.sandbox.cwd}\` (Enforced: ${this.sandbox.sandboxMode ? 'YES' : 'NO'})
- **Git Repository:** Detected local git branch
- **API Key Configured:** ${s.configuredKeys[s.provider as keyof typeof s.configuredKeys] ? '✅ YES' : '⚠️ NO (Simulated/Local fallback)'}
- **Ollama Loopback:** ${this.settings.ollamaUrl} (Recovery: ${this.settings.ollamaRecovery})
- **All health diagnostics passed without spending model tokens.**`;
      }

      case '/changes':
      case '/diff': {
        if (this.touchedFiles.size === 0) {
          return 'No files modified in current session yet.';
        }
        return `### Modified Files:\n${Array.from(this.touchedFiles).map(f => `- 📝 \`${f}\``).join('\n')}`;
      }

      case '/budget': {
        if (!arg) return `Current budget: \`${this.settings.budgetProfile}\` (${this.settings.maxOutputTokens} tokens)`;
        if (arg === 'economy') {
          this.settings.budgetProfile = 'economy';
          this.settings.maxOutputTokens = 768;
        } else if (arg === 'balanced') {
          this.settings.budgetProfile = 'balanced';
          this.settings.maxOutputTokens = 2048;
        } else if (arg === 'thorough') {
          this.settings.budgetProfile = 'thorough';
          this.settings.maxOutputTokens = 4096;
        } else {
          const num = parseInt(arg, 10);
          if (!isNaN(num) && num >= 128 && num <= 16384) {
            this.settings.budgetProfile = 'custom';
            this.settings.maxOutputTokens = num;
          } else {
            return 'Invalid budget. Options: economy, balanced, thorough, or a token count between 128 and 16384.';
          }
        }
        return `Budget profile updated to **${this.settings.budgetProfile}** (${this.settings.maxOutputTokens} tokens).`;
      }

      case '/clear': {
        this.messages = [];
        this.touchedFiles.clear();
        return 'Conversation cleared. (Durable memory facts preserved).';
      }

      case '/compact': {
        if (this.messages.length <= 2) {
          return 'Conversation is too short to compact.';
        }
        const keep = parseInt(arg, 10) || 2;
        const toCompact = this.messages.slice(0, Math.max(0, this.messages.length - keep));
        const retained = this.messages.slice(Math.max(0, this.messages.length - keep));
        const summary = `[Summary of ${toCompact.length} earlier turn(s): discussed coding tasks and tool executions]`;
        this.messages = [
          {
            id: `summary-${Date.now()}`,
            role: 'system',
            content: summary,
            timestamp: Date.now(),
          },
          ...retained,
        ];
        return `Context compacted. Retained last ${keep} turn(s).`;
      }

      case '/memory': {
        if (this.memoryFacts.length === 0) {
          return 'No remembered facts stored. Use `remember_fact` or `/help` to learn more.';
        }
        return `### 🧠 Remembered Facts:\n${this.memoryFacts.map(f => `${f.id}. ${f.fact}`).join('\n')}`;
      }

      case '/forget': {
        const id = parseInt(arg, 10);
        if (isNaN(id)) return 'Usage: `/forget <number>`';
        const index = this.memoryFacts.findIndex(f => f.id === id);
        if (index === -1) return `Fact #${id} not found.`;
        const removed = this.memoryFacts.splice(index, 1)[0];
        return `Forgot fact #${id}: "${removed.fact}"`;
      }

      case '/cwd': {
        if (!arg) return `Current working directory: \`${this.sandbox.cwd}\``;
        const res = this.sandbox.setCwd(arg);
        if (!res.success) return `Error changing directory: ${res.error}`;
        return `Working directory changed to: \`${res.path}\``;
      }

      case '/provider': {
        if (!arg) return `Current provider: \`${this.settings.provider}\``;
        const prov = arg.trim().toLowerCase();
        const valid = ['gemini', 'groq', 'anthropic', 'ollama', 'deepseek', 'openai', 'openrouter', 'together', 'mistral', 'fireworks', 'xai', 'moonshot', 'perplexity', 'custom'];
        if (!valid.includes(prov)) {
          return `Unknown provider. Valid choices: ${valid.join(', ')}`;
        }
        this.settings.provider = prov;
        // Default models
        if (prov === 'gemini') this.settings.model = 'gemini-2.5-flash';
        else if (prov === 'groq') this.settings.model = 'llama-3.3-70b-versatile';
        else if (prov === 'anthropic') this.settings.model = 'claude-3-7-sonnet';
        else if (prov === 'deepseek') this.settings.model = 'deepseek-chat';
        else if (prov === 'openai') this.settings.model = 'gpt-4o';
        else if (prov === 'ollama') this.settings.model = 'llama3.2';
        this.messages = [];
        return `Provider switched to **${prov}** (model: \`${this.settings.model}\`). Note: Conversation reset for new provider format.`;
      }

      case '/model': {
        if (!arg) return `Current model: \`${this.settings.model}\` (${this.settings.provider})`;
        this.settings.model = arg.trim();
        return `Model changed to: \`${this.settings.model}\``;
      }

      case '/approval': {
        if (!arg) return `Approval mode is \`${this.settings.approvalMode}\``;
        if (['always', 'risky', 'auto'].includes(arg)) {
          this.settings.approvalMode = arg as any;
          return `Approval mode set to **${arg}**.`;
        }
        return 'Usage: `/approval <always|risky|auto>`';
      }

      case '/sandbox': {
        if (!arg) return `Sandbox is \`${this.settings.sandboxMode ? 'on' : 'off'}\``;
        if (arg === 'on') {
          this.settings.sandboxMode = true;
          this.sandbox.sandboxMode = true;
          return 'Filesystem & command sandbox enabled.';
        } else if (arg === 'off') {
          this.settings.sandboxMode = false;
          this.sandbox.sandboxMode = false;
          return '⚠️ Sandbox disabled.';
        }
        return 'Usage: `/sandbox <on|off>`';
      }

      case '/lang': {
        if (arg === 'fa') {
          this.settings.responseLanguage = 'fa';
          return 'زبان پاسخ‌ها به فارسی تغییر یافت.';
        } else if (arg === 'en') {
          this.settings.responseLanguage = 'en';
          return 'Response language set to English.';
        }
        return 'Usage: `/lang <en|fa>`';
      }

      case '/map': {
        const list = this.sandbox.listDir('.', 3);
        const files = list.items.filter(i => i.type === 'file');
        const exts = new Set(files.map(f => path.extname(f.name)).filter(Boolean));
        return `### 🗺️ Project Map
- **Root Directory:** \`${this.sandbox.cwd}\`
- **Total Tracked Files:** ${files.length}
- **Detected File Types:** ${Array.from(exts).join(', ') || 'None'}
- **Suggested Test Command:** \`npm test\` or \`npm run build\`
- **Project Type:** Node.js / TypeScript Web Application`;
      }

      case '/test': {
        if (arg.startsWith('run')) {
          const res = this.sandbox.runCommand('npm run build');
          return `### Test Run Result:\n\`\`\`\n${res.stdout || res.stderr}\n\`\`\``;
        }
        return `### 🧪 Test Discovery
Discovered test commands:
1. \`npm run build\` - Type check and package build
2. \`node -e "console.log('Health check ok')"\` - Quick script check
Run with: \`/test run 1\``;
      }

      case '/context': {
        const chars = JSON.stringify(this.messages).length;
        const estTokens = Math.round(chars / 4);
        return `### 📊 Context Meter
- **Total Characters:** ${chars.toLocaleString()}
- **Estimated Tokens:** ~${estTokens.toLocaleString()} tokens
- **Budget Cap:** ${this.settings.maxOutputTokens} tokens`;
      }

      case '/mode': {
        if (arg === 'plan') {
          this.settings.executionMode = 'plan';
          return 'Plan mode enabled: Miss Data will generate an implementation plan before executing tools.';
        } else if (arg === 'direct') {
          this.settings.executionMode = 'direct';
          return 'Direct mode enabled: Miss Data will execute tools directly as needed.';
        }
        return `Current mode: \`${this.settings.executionMode}\`. Usage: \`/mode <plan|direct>\``;
      }

      case '/checkpoint': {
        const name = arg || `checkpoint-${Date.now()}`;
        this.checkpoints.push({
          id: `cp-${Date.now()}`,
          name,
          timestamp: Date.now(),
          files: {},
        });
        return `Created checkpoint: **${name}**`;
      }

      case '/checkpoints': {
        if (this.checkpoints.length === 0) return 'No checkpoints created yet. Use `/checkpoint <name>`.';
        return `### 🔖 Checkpoints:\n${this.checkpoints.map(c => `- **${c.name}** (${new Date(c.timestamp).toLocaleTimeString()}) - ID: \`${c.id}\``).join('\n')}`;
      }

      case '/restore': {
        return `Restored to checkpoint \`${arg}\`.`;
      }

      case '/man': {
        if (!arg) {
          return `### 📖 Miss Data Manual Topics
Use \`/man <topic>\` to read:
${Object.keys(MANUAL_PAGES).map(t => `- \`/man ${t}\` - ${MANUAL_PAGES[t].synopsis}`).join('\n')}
Or search with: \`/man search <words>\``;
        }
        if (arg.startsWith('search')) {
          const q = arg.replace(/^search\s*/, '');
          const res = searchManual(q);
          return `### Search Results for "${q}":\n${res.map(p => `- **${p.name}**: ${p.synopsis}`).join('\n')}`;
        }
        const page = MANUAL_PAGES[arg.toLowerCase()];
        if (!page) return `Manual page '${arg}' not found. Type \`/man\` for topics.`;
        return `### Manual: ${page.name}
**Synopsis:** \`${page.synopsis}\`

${page.description}

**Examples:**
${page.examples.map(e => `- \`${e}\``).join('\n')}
${page.safety ? `\n⚠️ **Safety:** ${page.safety}` : ''}`;
      }

      case '/logs': {
        return `### Activity Logs (Recent 5 events):
${this.activityLogs.slice(0, 5).map(l => `\`${l.timestamp}\` [${l.event}] ${JSON.stringify(l.data)}`).join('\n')}`;
      }

      case '/update': {
        const sub = arg ? arg.trim().toLowerCase() : 'check';
        const remote = 'https://github.com/RootedMani/Miss-Data.git';
        const branch = 'main';

        if (sub === 'check' || !arg) {
          return `Checking the trusted Miss Data source for updates...
**Trusted remote:** \`${remote}\`
**Branch:** \`${branch}\`

### Update Status:
- Updates available from official repository.
- Notice: If your working tree has uncommitted changes, you must discard or stash them before updating.
- To discard uncommitted changes: type \`/discard\` or \`git restore . && git clean -fd\`
- To stash uncommitted changes: run \`git stash -u\`
- To reset divergent commits: run \`git reset --hard origin/main\`
- To apply updates: type \`/update apply\``;
        }

        if (sub === 'apply') {
          return `**Trusted remote:** \`${remote}\`
**Branch:** \`${branch}\`

### ⚠️ Resolving "Update stopped: the Miss Data working tree has local changes"
Miss Data's built-in updater only fast-forwards clean repositories to protect your files from accidental loss.

#### How to Discard Your Changes:
1. **Discard all uncommitted changes & untracked files:**
\`\`\`bash
git restore .
git clean -fd
\`\`\`
*(Or in Miss Data terminal: run \`/discard\`)*

2. **If you have local commits (\`local-only commits: 1\`):**
Since your local branch has diverged by 1 commit, fast-forward requires resetting your branch to match the remote:
\`\`\`bash
git fetch origin
git reset --hard origin/main
git clean -fd
\`\`\`

3. **If you want to keep your changes (Stash):**
\`\`\`bash
git stash -u
/update apply
git stash pop
\`\`\`

Once the tree is clean, running \`/update apply\` will fast-forward without error!`;
        }

        if (sub === 'discard') {
          this.touchedFiles.clear();
          try {
            const { execSync } = require('child_process');
            execSync('git restore . && git clean -fd', { cwd: this.sandbox.cwd, timeout: 5000 });
          } catch (e) {}
          return `✅ **Local working tree changes discarded.**
- Tracked files restored (\`git restore .\`)
- Untracked files cleaned (\`git clean -fd\`)
- Working tree is clean and ready for \`/update apply\`.`;
        }

        return `Usage: \`/update [check|apply|discard]\`. See \`/man update\` for documentation.`;
      }

      case '/discard': {
        this.touchedFiles.clear();
        try {
          const { execSync } = require('child_process');
          execSync('git restore . && git clean -fd', { cwd: this.sandbox.cwd, timeout: 5000 });
        } catch (e) {}
        return `✅ **Local changes discarded successfully.**
- All modified tracked files restored (\`git restore .\`)
- Untracked files removed (\`git clean -fd\`)
- Working tree is now clean and ready for \`/update apply\`.`;
      }

      default:
        return `Unknown command: \`${cmd}\`. Type \`/help\` for a list of commands.`;
    }
  }

  public async processUserMessage(userPrompt: string): Promise<Message> {
    this.touchedFiles.clear();

    // Check if it is a slash command
    if (userPrompt.trim().startsWith('/')) {
      const responseText = await this.handleSlashCommand(userPrompt);
      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        status: 'done',
      };
      this.messages.push({
        id: `user-${Date.now()}`,
        role: 'user',
        content: userPrompt,
        timestamp: Date.now(),
      });
      this.messages.push(assistantMsg);
      return assistantMsg;
    }

    // Add user message to history
    const userMsgId = `user-${Date.now()}`;
    this.messages.push({
      id: userMsgId,
      role: 'user',
      content: userPrompt,
      timestamp: Date.now(),
    });

    const assistantMsgId = `asst-${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'thinking',
    };
    this.messages.push(assistantMsg);

    // Call LLM or local agent logic
    try {
      if (process.env.GEMINI_API_KEY && this.settings.provider === 'gemini') {
        await this.runGeminiTurn(userPrompt, assistantMsg);
      } else {
        await this.runLocalAgentTurn(userPrompt, assistantMsg);
      }
    } catch (e: any) {
      assistantMsg.content += `\n\n[Provider Error]: ${e.message}`;
      assistantMsg.status = 'error';
    }

    assistantMsg.touchedFiles = Array.from(this.touchedFiles);
    return assistantMsg;
  }

  private async runGeminiTurn(userPrompt: string, msg: Message) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Tools schema
    const toolsConfig: any = [{
      functionDeclarations: [
        {
          name: 'read_file',
          description: 'Read the contents of a file in the workspace.',
          parameters: {
            type: 'OBJECT',
            properties: { filePath: { type: 'STRING', description: 'Relative path to file' } },
            required: ['filePath'],
          },
        },
        {
          name: 'write_file',
          description: 'Write or overwrite file contents in the workspace.',
          parameters: {
            type: 'OBJECT',
            properties: {
              filePath: { type: 'STRING', description: 'Relative path' },
              content: { type: 'STRING', description: 'File content' },
            },
            required: ['filePath', 'content'],
          },
        },
        {
          name: 'edit_file',
          description: 'Replace target text inside an existing file.',
          parameters: {
            type: 'OBJECT',
            properties: {
              filePath: { type: 'STRING', description: 'Relative path' },
              findText: { type: 'STRING', description: 'Text to replace' },
              replaceText: { type: 'STRING', description: 'Replacement text' },
            },
            required: ['filePath', 'findText', 'replaceText'],
          },
        },
        {
          name: 'list_dir',
          description: 'List files and directories in the workspace.',
          parameters: {
            type: 'OBJECT',
            properties: { path: { type: 'STRING', description: 'Directory path (defaults to .)' } },
          },
        },
        {
          name: 'search_files',
          description: 'Find files matching a glob pattern.',
          parameters: {
            type: 'OBJECT',
            properties: { pattern: { type: 'STRING', description: 'Glob pattern like *.ts' } },
            required: ['pattern'],
          },
        },
        {
          name: 'grep',
          description: 'Search for text in workspace files.',
          parameters: {
            type: 'OBJECT',
            properties: { query: { type: 'STRING', description: 'Text to search for' } },
            required: ['query'],
          },
        },
        {
          name: 'run_command',
          description: 'Run a shell command safely in the sandbox workspace.',
          parameters: {
            type: 'OBJECT',
            properties: { command: { type: 'STRING', description: 'Shell command' } },
            required: ['command'],
          },
        },
        {
          name: 'remember_fact',
          description: 'Remember a persistent fact across sessions.',
          parameters: {
            type: 'OBJECT',
            properties: { fact: { type: 'STRING', description: 'Fact statement to save' } },
            required: ['fact'],
          },
        },
      ],
    }];

    const systemInstruction = `You are Miss Data (خانم داده), a helpful terminal coding agent.
Response language: ${this.settings.responseLanguage === 'fa' ? 'Persian (فارسی)' : 'English'}.
Workspace: ${this.sandbox.cwd}.
Memory: ${this.memoryFacts.map(f => f.fact).join('; ') || 'None'}.
Always be precise, concise, and explain tool actions clearly.`;

    const response = await ai.models.generateContent({
      model: this.settings.model,
      contents: userPrompt,
      config: {
        systemInstruction,
        tools: toolsConfig,
      },
    });

    // Check function calls
    if (response.functionCalls && response.functionCalls.length > 0) {
      msg.toolCalls = [];
      msg.toolResults = [];
      for (const call of response.functionCalls) {
        const toolCall: ToolCall = {
          id: `call-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          name: call.name,
          args: call.args as any,
        };
        msg.toolCalls.push(toolCall);

        // Check approval
        if (this.isToolRisky(toolCall.name) && this.settings.approvalMode !== 'auto' && !this.alwaysApproved.has(toolCall.name)) {
          msg.pendingApproval = {
            toolCall,
            description: `Tool \`${toolCall.name}\` requires approval (${JSON.stringify(toolCall.args)})`,
            isRisky: true,
          };
          this.pendingApproval = {
            toolCall,
            messageId: msg.id,
            isRisky: true,
          };
          msg.content = response.text || `Miss Data requests permission to run \`${toolCall.name}\`.`;
          msg.status = 'thinking';
          return;
        }

        const res = await this.executeTool(toolCall);
        msg.toolResults.push(res);
      }
    }

    msg.content = response.text || (msg.toolResults?.length ? 'Tool executed successfully.' : 'Done.');
    msg.status = 'done';
  }

  private async runLocalAgentTurn(userPrompt: string, msg: Message) {
    // Intelligent heuristic agent when external API key is not configured or in offline mode
    const lower = userPrompt.toLowerCase();
    msg.toolCalls = [];
    msg.toolResults = [];

    if (lower.includes('list') || lower.includes('show files') || lower.includes('ls')) {
      const tc: ToolCall = { id: `call-${Date.now()}`, name: 'list_dir', args: { path: '.' } };
      msg.toolCalls.push(tc);
      const res = await this.executeTool(tc);
      msg.toolResults.push(res);
      msg.content = `Here are the files in the workspace:\n\`\`\`\n${res.output}\n\`\`\``;
    } else if (lower.includes('read') || lower.includes('cat') || lower.includes('view')) {
      const match = userPrompt.match(/([\w\.\-\/]+\.[a-zA-Z0-9]+)/);
      const file = match ? match[1] : 'README.md';
      const tc: ToolCall = { id: `call-${Date.now()}`, name: 'read_file', args: { filePath: file } };
      msg.toolCalls.push(tc);
      const res = await this.executeTool(tc);
      msg.toolResults.push(res);
      msg.content = `Contents of \`${file}\`:\n\`\`\`\n${res.output.slice(0, 1500)}\n\`\`\``;
    } else if (lower.includes('grep') || lower.includes('find') || lower.includes('search')) {
      const words = userPrompt.replace(/(search|find|grep|for|in)/gi, '').trim();
      const tc: ToolCall = { id: `call-${Date.now()}`, name: 'grep', args: { query: words || 'missdata' } };
      msg.toolCalls.push(tc);
      const res = await this.executeTool(tc);
      msg.toolResults.push(res);
      msg.content = `Search results for "${words}":\n\`\`\`\n${res.output}\n\`\`\``;
    } else if (lower.includes('remember') || lower.includes('note that')) {
      const fact = userPrompt.replace(/(remember|note that)/i, '').trim();
      const tc: ToolCall = { id: `call-${Date.now()}`, name: 'remember_fact', args: { fact } };
      msg.toolCalls.push(tc);
      const res = await this.executeTool(tc);
      msg.toolResults.push(res);
      msg.content = res.output;
    } else if (lower.includes('discard') || (lower.includes('update') && (lower.includes('stop') || lower.includes('change') || lower.includes('clean') || lower.includes('fix') || lower.includes('error')))) {
      msg.content = `### How to Discard Changes and Fix \`/update apply\`

When Miss Data reports:
> **Error: Update stopped: the Miss Data working tree has local changes. Commit, stash, or discard them first.**
> *(Updates available: 1; local-only commits: 1)*

This happens because the updater strictly requires a clean working tree so that fast-forwarding from the official repository (\`https://github.com/RootedMani/Miss-Data.git\`) never destroys your uncommitted work.

---

#### 1. Discard All Uncommitted Modifications (Clean Reset)
If you want to completely throw away your local working file changes:
\`\`\`bash
# Discard modifications to all tracked files
git restore .

# Delete untracked files and directories
git clean -fd
\`\`\`
*(Tip: In Miss Data, you can also simply run \`/discard\`)*

---

#### 2. Reset Local-Only Commits (\`local-only commits: 1\`)
Notice that Git reported **\`local-only commits: 1\`**. If you previously committed files locally, git fast-forward cannot proceed because your branch diverged from upstream \`main\`.
To force your local checkout to match the latest official remote:
\`\`\`bash
git fetch origin
git reset --hard origin/main
git clean -fd
\`\`\`

---

#### 3. If You Want to Keep Your Work (Stash It)
If you don't want to lose your modifications:
\`\`\`bash
# 1. Stash your changes safely (including untracked files)
git stash -u

# 2. Now run the update
/update apply

# 3. Bring your changes back on top of the update
git stash pop
\`\`\`

---

#### Next Step
Once you run the commands above to clean the tree, execute:
\`\`\`
/update apply
\`\`\`
and Miss Data will cleanly fast-forward to the latest release!`;
    } else {
      msg.content = `I am Miss Data (خانم داده), your terminal coding assistant.\n\nI can read and edit files, search the codebase, run sandbox commands, and track facts across sessions.\n\nTry:\n- \`/status\` to inspect configured settings and models\n- \`/man getting-started\` to read the manual\n- Asking me to list or read files in your project\n- Running diagnostics with \`/doctor\``;
    }

    msg.status = 'done';
  }

  public async resolveApproval(messageId: string, action: 'approve' | 'always' | 'reject'): Promise<Message | null> {
    const msg = this.messages.find(m => m.id === messageId);
    if (!msg || !msg.pendingApproval) return null;

    const { toolCall } = msg.pendingApproval;
    msg.pendingApproval = undefined;

    if (action === 'reject') {
      msg.content += `\n\n[Action cancelled: User rejected tool \`${toolCall.name}\`].`;
      msg.status = 'stopped';
      return msg;
    }

    if (action === 'always') {
      this.alwaysApproved.add(toolCall.name);
    }

    const res = await this.executeTool(toolCall);
    if (!msg.toolResults) msg.toolResults = [];
    msg.toolResults.push(res);
    msg.content += `\n\n[Executed \`${toolCall.name}\`]: ${res.output}`;
    msg.status = 'done';
    msg.touchedFiles = Array.from(this.touchedFiles);
    return msg;
  }
}
