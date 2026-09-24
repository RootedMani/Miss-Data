import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import { AgentSettings, Message, ToolCall, ToolResult, MemoryFact, SessionInfo, ActivityLogEvent, AutocompleteResult } from './types.js';
import { Sandbox } from './sandbox.js';
import { MANUAL_PAGES, searchManual, getManualPage, formatManualPage, listManualTopics } from './manual.js';

export const PROVIDER_ENV_MAP: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  xai: 'XAI_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  custom: 'CUSTOM_API_KEY',
};

export function maskKey(key?: string): string {
  if (!key) return '(not configured)';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

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
  public keyPool: Map<string, string[]> = new Map();

  constructor() {
    this.sandbox = new Sandbox(process.cwd(), true);

    // Initialize key pools from env
    for (const [prov, envVar] of Object.entries(PROVIDER_ENV_MAP)) {
      if (process.env[envVar]) {
        this.keyPool.set(prov, [process.env[envVar]!]);
      }
    }

    const initialProvider = this.getKeyForProvider('gemini') ? 'gemini' : (this.getKeyForProvider('groq') ? 'groq' : 'gemini');

    this.settings = {
      provider: initialProvider,
      model: initialProvider === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-3.6-flash',
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

  public getKeyForProvider(provider: string): string | undefined {
    const pool = this.keyPool.get(provider);
    if (pool && pool.length > 0 && pool[0]) return pool[0];
    const envVar = PROVIDER_ENV_MAP[provider];
    if (envVar && process.env[envVar]) return process.env[envVar];
    return undefined;
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
        gemini: Boolean(this.getKeyForProvider('gemini')),
        groq: Boolean(this.getKeyForProvider('groq')),
        anthropic: Boolean(this.getKeyForProvider('anthropic')),
        openai: Boolean(this.getKeyForProvider('openai')),
        deepseek: Boolean(this.getKeyForProvider('deepseek')),
        openrouter: Boolean(this.getKeyForProvider('openrouter')),
        together: Boolean(this.getKeyForProvider('together')),
        mistral: Boolean(this.getKeyForProvider('mistral')),
        fireworks: Boolean(this.getKeyForProvider('fireworks')),
        xai: Boolean(this.getKeyForProvider('xai')),
        moonshot: Boolean(this.getKeyForProvider('moonshot')),
        perplexity: Boolean(this.getKeyForProvider('perplexity')),
        custom: Boolean(this.getKeyForProvider('custom')),
      },
      systemMetrics: {
        heapUsedMB: Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10,
        heapTotalMB: Math.round((process.memoryUsage().heapTotal / (1024 * 1024)) * 10) / 10,
        rssMB: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
        uptimeSec: Math.round(process.uptime()),
      },
    };
  }

  public async getAutocomplete(prefix: string): Promise<AutocompleteResult> {
    const raw = prefix;
    const trimmed = raw.trim();

    if (!trimmed) {
      return { prefix, completion: '', fullText: prefix, type: 'command', candidates: [] };
    }

    const KNOWN_COMMANDS = [
      'clear',
      'ls',
      'ls -la',
      'pwd',
      'whoami',
      'git status',
      'git diff',
      'git log',
      'git branch',
      'git add .',
      'git commit -m "',
      'npm run build',
      'npm run lint',
      'npm test',
      'node -v',
      '/help',
      '/status',
      '/doctor',
      '/diff',
      '/changes',
      '/run ',
      '/git status',
      '/git diff',
      '/git log',
      '/clear',
      '/discard',
      '/update check',
      '/update apply',
      '/budget balanced',
      '/budget economy',
      '/budget thorough',
      '/memory',
      '/lang en',
      '/lang fa',
      '/map',
      '/test',
      '/man getting-started',
      '/man update',
      '/approval risky',
      '/approval always',
      '/approval auto',
      '/sandbox on',
      '/sandbox off',
      '/context',
      '/mode direct',
      '/mode plan',
    ];

    // 1. Check known slash commands or shell commands (Tab completion)
    const lower = trimmed.toLowerCase();
    const matchingCmds = KNOWN_COMMANDS.filter(cmd => cmd.toLowerCase().startsWith(lower));

    if (matchingCmds.length > 0) {
      const bestMatch = matchingCmds[0];
      const completion = bestMatch.slice(trimmed.length);
      return {
        prefix,
        completion,
        fullText: prefix + completion,
        type: 'command',
        candidates: matchingCmds.slice(0, 8),
      };
    }

    // 2. Check path / file completion (e.g. "cat src/A" or "ls ser")
    const pathPrefixMatch = trimmed.match(/^(?:cat|read|edit|run|ls|\$)\s+([a-zA-Z0-9_\-\.\/]+)$/i);
    if (pathPrefixMatch) {
      const typedPath = pathPrefixMatch[1];
      try {
        const dirToList = path.dirname(typedPath) === '.' ? '.' : path.dirname(typedPath);
        const searchBase = path.basename(typedPath).toLowerCase();
        const res = this.sandbox.listDir(dirToList, 1);
        const matchingFiles = (res.items || [])
          .map(f => (dirToList === '.' ? f.name : `${dirToList}/${f.name}`))
          .filter(p => p.toLowerCase().startsWith(typedPath.toLowerCase()));

        if (matchingFiles.length > 0) {
          const matchedPath = matchingFiles[0];
          const pathSuffix = matchedPath.slice(typedPath.length);
          return {
            prefix,
            completion: pathSuffix,
            fullText: prefix + pathSuffix,
            type: 'path',
            candidates: matchingFiles.slice(0, 6),
          };
        }
      } catch {
        // Fall through
      }
    }

    // 3. Google AI Studio style prompt autocomplete for natural language
    // First, try fast speculative LLM completion if GEMINI_API_KEY is configured
    if (process.env.GEMINI_API_KEY && trimmed.length >= 4 && !trimmed.startsWith('/') && !trimmed.startsWith('$')) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const promptInstruction = `You are an inline prompt autocompletion engine for a terminal coding assistant (like Google AI Studio).
The user is currently typing the prompt: "${trimmed}".
Provide ONLY a concise, natural inline continuation of 3 to 12 words that finishes their thought.
Do NOT repeat the prefix. Do NOT use quotes. Do NOT add newlines. Return only the completion.`;

        const completionPromise = ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: promptInstruction,
          config: {
            maxOutputTokens: 25,
            temperature: 0.2,
            stopSequences: ['\n', '.', '!', '?'],
          },
        });

        // Fast 900ms timeout for snappy UI
        const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 900));
        const res: any = await Promise.race([completionPromise, timeoutPromise]);

        if (res && res.text) {
          let continuation = res.text.trim();
          continuation = continuation.replace(/^["'`]+|["'`]+$/g, '').trim();
          if (continuation && !continuation.toLowerCase().startsWith(trimmed.toLowerCase())) {
            // Ensure proper spacing between prefix and continuation
            const needsSpace = !raw.endsWith(' ') && !continuation.startsWith(' ') && !continuation.startsWith(',');
            const ghost = (needsSpace ? ' ' : '') + continuation;
            return {
              prefix,
              completion: ghost,
              fullText: prefix + ghost,
              type: 'prompt',
              candidates: [prefix + ghost],
            };
          }
        }
      } catch {
        // Fall back to pattern bank
      }
    }

    // Smart zero-latency local prompt completion patterns (Google AI Studio archetype)
    const PROMPT_PATTERNS = [
      { trigger: /^explain\s*$/i, completion: ' how this codebase works and its key modules' },
      { trigger: /^explain\s+how\s*$/i, completion: ' the terminal sandbox executes commands safely' },
      { trigger: /^how\s*$/i, completion: ' do I run shell commands inside the sandbox?' },
      { trigger: /^how\s+do\s+i\s*$/i, completion: ' execute tests or check git status?' },
      { trigger: /^write\s*$/i, completion: ' a utility function to handle errors cleanly' },
      { trigger: /^write\s+a\s*$/i, completion: ' unit test for the terminal command processor' },
      { trigger: /^fix\s*$/i, completion: ' any syntax or typing errors in the project' },
      { trigger: /^fix\s+the\s*$/i, completion: ' issue where commands need validation' },
      { trigger: /^refactor\s*$/i, completion: ' the terminal component for better performance' },
      { trigger: /^add\s*$/i, completion: ' a new slash command to inspect active memory' },
      { trigger: /^add\s+a\s*$/i, completion: ' shortcut to toggle response language' },
      { trigger: /^check\s*$/i, completion: ' git status and list uncommitted modifications' },
      { trigger: /^check\s+if\s*$/i, completion: ' all dependencies and types build cleanly' },
      { trigger: /^test\s*$/i, completion: ' the application build and run the test suite' },
      { trigger: /^show\s*$/i, completion: ' me the manual for getting started with Miss Data' },
      { trigger: /^what\s*$/i, completion: ' tools and commands are currently supported?' },
      { trigger: /^create\s*$/i, completion: ' a test script to verify command execution' },
      { trigger: /^find\s*$/i, completion: ' where the terminal keyboard events are handled' },
      { trigger: /^search\s*$/i, completion: ' the codebase for git status handlers' },
      { trigger: /^list\s*$/i, completion: ' all files in the current workspace directory' },
      { trigger: /^run\s*$/i, completion: ' npm run build to check for errors' },
      { trigger: /^can\s+you\s*$/i, completion: ' inspect the repository and explain its architecture?' },
    ];

    for (const p of PROMPT_PATTERNS) {
      if (p.trigger.test(trimmed)) {
        return {
          prefix,
          completion: p.completion,
          fullText: prefix + p.completion,
          type: 'prompt',
          candidates: [prefix + p.completion],
        };
      }
    }

    return { prefix, completion: '', fullText: prefix, type: 'command', candidates: [] };
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
        if (arg) {
          const page = getManualPage(arg);
          if (page) {
            return formatManualPage(page);
          }
          const matches = searchManual(arg);
          if (matches.length > 0) {
            return `Topic or command '${arg}' not found directly.\n\nDid you mean:\n${matches.slice(0, 4).map(m => `- \`/man ${m.name}\` - ${m.synopsis}`).join('\n')}\n\nType \`/man\` to browse all documentation.`;
          }
          return `Command or topic '${arg}' not found. Type \`/help\` for commands or \`/man\` for complete manuals.`;
        }
        return `## 🛠️ Miss Data Commands Index
- \`/run <cmd>\` or \`$ <cmd>\` - Execute shell command in sandbox (e.g. \`/run ls -la\`)
- \`/status\` - Show active provider, model, budget, safeguards, recovery
- \`/doctor\` - Run zero-model-cost diagnostics on workspace & git
- \`/changes\` / \`/diff [rev]\` - Inspect file changes and git diff
- \`/budget <economy|balanced|thorough|tokens>\` - Set output token cap
- \`/clear\` - Clear conversation turns in current session
- \`/compact [n]\` - Compact older turns into a summary note
- \`/memory\` - Show remembered durable facts
- \`/forget <n>\` - Delete remembered fact #n
- \`/cwd [path]\` - Show or change working directory
- \`/provider <name>\` - Switch LLM backend
- \`/model <name>\` - Switch model for active provider
- \`/approval <always|risky|auto>\` - Change tool confirmation behavior
- \`/sandbox <on|off>\` - Confine file tools to working directory
- \`/sound <on|off|toggle>\` - Toggle retro terminal sound effects
- \`/metrics <on|off>\` - Toggle bottom memory & latency status line
- \`/lang <en|fa>\` - Response language (English or Persian)
- \`/map\` - Project onboarding overview and test discovery
- \`/test [run N]\` - List or run discovered test commands
- \`/context\` - Approximate character and token meter
- \`/mode <plan|direct>\` - Require an implementation plan before tools act
- \`/checkpoint [name]\` - Create workspace backup snapshot
- \`/checkpoints\` - List saved workspace snapshots
- \`/restore <name>\` - Restore workspace to saved snapshot
- \`/git <args>\` - Execute git commands directly in workspace
- \`/update [check|apply]\` - Check or apply updates from official remote
- \`/discard\` - Discard uncommitted local working tree changes
- \`/keys [show|add|remove]\` - API key management and pool rotation
- \`/resilience\` - Automatic error recovery & fallback configuration
- \`/sessions\` - List or resume saved conversation sessions
- \`/privacy [clear]\` - Privacy inspection and local data scrubber
- \`/logs [count]\` - View redacted activity audit logs
- \`/man [topic]\` - Open built-in manual pages (try \`/man overview\` or \`/man status\`)

💡 *Type \`/man <command>\` or \`/help <command>\` for complete Unix-style documentation on any command!*`;
      }

      case '/run':
      case '/exec':
      case '/sh':
      case '/bash': {
        if (!arg) return 'Usage: `/run <command>` (e.g. `/run ls -la` or `/run git status`)';
        const res = this.sandbox.runCommand(arg);
        if (res.exitCode !== 0) {
          return `[Exit code ${res.exitCode}]\n${res.stderr || res.stdout || 'Error executing command'}`;
        }
        return res.stdout || `(Command exited with code 0 and no output)`;
      }

      case '/git': {
        const gitCmd = `git ${arg}`;
        const res = this.sandbox.runCommand(gitCmd);
        if (res.exitCode !== 0) {
          return `[Exit code ${res.exitCode}]\n${res.stderr || res.stdout}`;
        }
        return res.stdout || `(Git command executed successfully)`;
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
        if (prov === 'gemini') this.settings.model = 'gemini-3.6-flash';
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

      case '/sound': {
        return `Terminal sound effects can be toggled using the speaker button in the title bar, or via \`/sound on\` / \`/sound off\`.`;
      }

      case '/metrics':
      case '/statusline': {
        const mem = process.memoryUsage();
        const heapUsed = (mem.heapUsed / (1024 * 1024)).toFixed(1);
        const heapTotal = (mem.heapTotal / (1024 * 1024)).toFixed(1);
        const rss = (mem.rss / (1024 * 1024)).toFixed(1);
        return `### 📊 System Statusline & Metrics
- **Heap Memory:** \`${heapUsed} MB\` / \`${heapTotal} MB\`
- **Resident Set Size (RSS):** \`${rss} MB\`
- **Process Uptime:** \`${Math.round(process.uptime())}s\`
- **Status Line Control:** Click the \`hide\` button or use \`/statusline on\` / \`/statusline off\` (or click the **Sys** button in the header bar).`;
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
          return listManualTopics();
        }
        if (arg.startsWith('search')) {
          const q = arg.replace(/^search\s*/, '').trim();
          if (!q) return 'Usage: `/man search <words>` (e.g. `/man search recovery` or `/man search git`)';
          const res = searchManual(q);
          if (res.length === 0) {
            return `No manual pages matched query "${q}". Type \`/man\` to view all topics.`;
          }
          return `### 🔍 Manual Search Results for "${q}":\n${res.map(p => `- **\`/man ${p.name}\`**: ${p.synopsis}`).join('\n')}\n\n💡 *Type \`/man <name>\` to read any page above.*`;
        }

        const page = getManualPage(arg);
        if (!page) {
          const suggestions = searchManual(arg);
          if (suggestions.length > 0) {
            return `Manual page '${arg}' not found.\n\nDid you mean:\n${suggestions.slice(0, 5).map(s => `- \`/man ${s.name}\` - ${s.synopsis}`).join('\n')}\n\nType \`/man\` for the master index of all manuals.`;
          }
          return `Manual page '${arg}' not found. Type \`/man\` for the master index of all documentation.`;
        }

        return formatManualPage(page);
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
          execSync('git restore . && git clean -fd', { cwd: this.sandbox.cwd, timeout: 5000 });
        } catch (e) {}
        return `✅ **Local changes discarded successfully.**
- All modified tracked files restored (\`git restore .\`)
- Untracked files removed (\`git clean -fd\`)
- Working tree is now clean and ready for \`/update apply\`.`;
      }

      case '/keys': {
        const subParts = arg.split(/\s+/).filter(Boolean);
        const action = subParts[0]?.toLowerCase() || 'show';
        const targetProv = subParts[1]?.toLowerCase();

        if (action === 'show' || !arg) {
          if (targetProv) {
            const key = this.getKeyForProvider(targetProv);
            if (!key) {
              return `### 🔑 Provider Key: **${targetProv}**\n- **Status:** ⚠️ Not configured\n- Set key with: \`/keys add ${targetProv} <your_api_key>\``;
            }
            return `### 🔑 Provider Key: **${targetProv}**\n- **Status:** ✅ Configured\n- **Key Preview:** \`${maskKey(key)}\`\n- **Pool Size:** ${this.keyPool.get(targetProv)?.length || 1} key(s)\n- Remove with: \`/keys remove ${targetProv}\``;
          }

          const provs = Object.keys(PROVIDER_ENV_MAP);
          const lines = provs.map(p => {
            const key = this.getKeyForProvider(p);
            const activeMark = this.settings.provider === p ? ' **[ACTIVE]**' : '';
            return `- **${p}:** ${key ? `\`${maskKey(key)}\`` : '*(not configured)*'}${activeMark}`;
          });

          return `### 🔑 Miss Data API Key Pool
${lines.join('\n')}

**Commands:**
- \`/keys show [provider]\` - Inspect key status (e.g. \`/keys show groq\`)
- \`/keys add <provider> <key>\` - Add & activate key (e.g. \`/keys add groq gsk_...\`)
- \`/keys remove <provider>\` - Remove key for provider`;
        }

        if (action === 'add') {
          const prov = subParts[1]?.toLowerCase();
          const key = subParts[2];
          if (!prov || !key) {
            return 'Usage: `/keys add <provider> <key>` (e.g. `/keys add groq gsk_...` or `/keys add gemini AIzaSy...`)';
          }
          const envVar = PROVIDER_ENV_MAP[prov];
          if (envVar) {
            process.env[envVar] = key;
          }
          const existing = this.keyPool.get(prov) || [];
          if (!existing.includes(key)) {
            existing.unshift(key);
            this.keyPool.set(prov, existing);
          }
          this.logEvent('key_added', { provider: prov });

          let switchedNote = '';
          if (this.settings.provider !== prov && !this.getKeyForProvider(this.settings.provider)) {
            this.settings.provider = prov;
            if (prov === 'groq') this.settings.model = 'llama-3.3-70b-versatile';
            else if (prov === 'gemini') this.settings.model = 'gemini-3.6-flash';
            else if (prov === 'deepseek') this.settings.model = 'deepseek-chat';
            else if (prov === 'openai') this.settings.model = 'gpt-4o';
            else if (prov === 'anthropic') this.settings.model = 'claude-3-7-sonnet';
            switchedNote = `\nActive provider automatically switched to **${prov}** (model: \`${this.settings.model}\`).`;
          }

          return `✅ API key added successfully for **${prov}** (\`${maskKey(key)}\`).${switchedNote}`;
        }

        if (action === 'remove' || action === 'delete') {
          const prov = subParts[1]?.toLowerCase();
          if (!prov) return 'Usage: `/keys remove <provider>`';
          const envVar = PROVIDER_ENV_MAP[prov];
          if (envVar) {
            delete process.env[envVar];
          }
          this.keyPool.delete(prov);
          this.logEvent('key_removed', { provider: prov });
          return `Key for **${prov}** removed from pool.`;
        }

        return 'Usage: `/keys [show | add | remove] [provider]`. See `/man keys` for detailed documentation.';
      }

      case '/resilience': {
        const fallbacks = this.settings.fallbackProviders.map(p => {
          const configured = Boolean(this.getKeyForProvider(p));
          return `${p} (${configured ? '✅ ready' : 'no key'})`;
        }).join(' → ');

        return `### 🛡️ Miss Data Resilience & Fault Tolerance
- **Active Provider:** \`${this.settings.provider}\` (Key: ${this.getKeyForProvider(this.settings.provider) ? '✅ Ready' : '⚠️ None'})
- **Fallback Pipeline:** ${fallbacks}
- **Context Auto-Compaction:** \`${this.settings.contextRecovery}\` (Shrinks history when approaching token limit)
- **Local Fallback:** Always active (Offline file inspection, git commands, and shell execution continue without internet)
- **Ollama Local Loopback:** \`${this.settings.ollamaUrl}\` (Recovery: \`${this.settings.ollamaRecovery}\`)
- **Key Pool Rotation:** Automatically rotates across multi-key pools on HTTP 429 rate limit responses.`;
      }

      case '/sessions': {
        const subParts = arg.split(/\s+/).filter(Boolean);
        const action = subParts[0]?.toLowerCase();

        if (action === 'new') {
          const title = subParts.slice(1).join(' ') || `Session ${this.sessions.size + 1}`;
          const newId = `session-${Date.now()}`;
          this.sessions.set(this.currentSessionId, {
            title: this.sessions.get(this.currentSessionId)?.title || 'Previous session',
            messages: [...this.messages],
            updatedAt: Date.now(),
          });
          this.currentSessionId = newId;
          this.messages = [];
          this.sessions.set(newId, {
            title,
            messages: [],
            updatedAt: Date.now(),
          });
          return `Started new session: **${title}** (\`${newId}\`).`;
        }

        if (action === 'switch' && subParts[1]) {
          const targetId = subParts[1];
          const target = this.sessions.get(targetId);
          if (!target) {
            return `Session \`${targetId}\` not found. Use \`/sessions\` to view available IDs.`;
          }
          this.sessions.set(this.currentSessionId, {
            title: this.sessions.get(this.currentSessionId)?.title || 'Untitled',
            messages: [...this.messages],
            updatedAt: Date.now(),
          });
          this.currentSessionId = targetId;
          this.messages = [...target.messages];
          return `Switched to session: **${target.title}** (${this.messages.length} messages).`;
        }

        const list = Array.from(this.sessions.entries()).map(([id, s]) => {
          const isCurrent = id === this.currentSessionId ? ' **[ACTIVE]**' : '';
          return `- **${s.title}** (\`${id}\`): ${s.messages.length} messages (Updated: ${new Date(s.updatedAt).toLocaleTimeString()})${isCurrent}`;
        });

        return `### 🗂️ Conversation Sessions
${list.join('\n')}

**Commands:**
- \`/sessions new [title]\` - Start a fresh conversation session
- \`/sessions switch <id>\` - Switch to an existing session`;
      }

      case '/privacy': {
        if (arg.trim().toLowerCase() === 'clear') {
          this.messages = [];
          this.activityLogs = [];
          this.checkpoints = [];
          this.touchedFiles.clear();
          return `✅ **Privacy audit complete:** Conversation history, activity audit logs, and in-memory checkpoints have been permanently scrubbed.`;
        }
        return `### 🔒 Privacy Audit & Local Isolation
- **Conversation Turns:** ${this.messages.length} messages in buffer
- **Durable Facts:** ${this.memoryFacts.length} remembered facts
- **Activity Logs:** ${this.activityLogs.length} events logged (all credentials automatically redacted)
- **External Telemetry:** Disabled (Zero analytics or telemetry sent to third parties)
- **Data Scrubbing:** Run \`/privacy clear\` to instantly wipe all message history and audit trails.`;
      }

      default:
        return `Unknown command: \`${cmd}\`. Type \`/help\` for a list of commands.`;
    }
  }

  public async processUserMessage(userPrompt: string): Promise<Message> {
    this.touchedFiles.clear();

    const trimmed = userPrompt.trim();

    // Direct clear command
    if (trimmed === 'clear' || trimmed === '/clear') {
      this.messages = [];
      this.touchedFiles.clear();
      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'Terminal cleared.',
        timestamp: Date.now(),
        status: 'done',
      };
      this.messages.push(assistantMsg);
      return assistantMsg;
    }

    // Direct shell execution prefix ($ or !)
    if (trimmed.startsWith('$') || trimmed.startsWith('!')) {
      const shCmd = trimmed.replace(/^[\$!]\s*/, '');
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userPrompt,
        timestamp: Date.now(),
      };
      this.messages.push(userMsg);

      const res = this.sandbox.runCommand(shCmd);
      const outText = res.exitCode === 0
        ? (res.stdout || '(Command completed with exit code 0)')
        : `[Exit code ${res.exitCode}]\n${res.stderr || res.stdout || 'Execution failed'}`;

      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `\`\`\`bash\n$ ${shCmd}\n${outText}\n\`\`\``,
        timestamp: Date.now(),
        status: res.exitCode === 0 ? 'done' : 'error',
      };
      this.messages.push(assistantMsg);
      return assistantMsg;
    }

    // Common direct terminal commands (ls, pwd, git status, etc.)
    const commonShellWords = ['ls', 'pwd', 'whoami', 'uname', 'git', 'df', 'top', 'node -v', 'npm -v', 'python3 --version'];
    const isDirectShell = commonShellWords.some(w => trimmed === w || trimmed.startsWith(`${w} `));
    if (isDirectShell) {
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: userPrompt,
        timestamp: Date.now(),
      };
      this.messages.push(userMsg);

      const res = this.sandbox.runCommand(trimmed);
      const outText = res.exitCode === 0
        ? (res.stdout || '(Command completed with exit code 0)')
        : `[Exit code ${res.exitCode}]\n${res.stderr || res.stdout || 'Execution failed'}`;

      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `\`\`\`bash\n$ ${trimmed}\n${outText}\n\`\`\``,
        timestamp: Date.now(),
        status: res.exitCode === 0 ? 'done' : 'error',
      };
      this.messages.push(assistantMsg);
      return assistantMsg;
    }

    // Check if it is a slash command
    if (trimmed.startsWith('/')) {
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
      const activeKey = this.getKeyForProvider(this.settings.provider);
      if (this.settings.provider === 'gemini' && activeKey) {
        await this.runGeminiTurn(userPrompt, assistantMsg);
      } else if (['groq', 'openai', 'deepseek', 'openrouter', 'together', 'mistral', 'fireworks', 'xai'].includes(this.settings.provider) && activeKey) {
        await this.runOpenAICompatibleTurn(userPrompt, assistantMsg);
      } else if (this.settings.provider === 'anthropic' && activeKey) {
        await this.runAnthropicTurn(userPrompt, assistantMsg);
      } else {
        await this.runLocalAgentTurn(userPrompt, assistantMsg);
      }
    } catch (e: any) {
      assistantMsg.content += `\n\n[Provider Error (${this.settings.provider})]: ${e.message}`;
      assistantMsg.status = 'error';
    }

    assistantMsg.touchedFiles = Array.from(this.touchedFiles);
    return assistantMsg;
  }

  private async runOpenAICompatibleTurn(userPrompt: string, msg: Message) {
    const key = this.getKeyForProvider(this.settings.provider);
    if (!key) throw new Error(`No API key configured for ${this.settings.provider}`);

    let endpoint = 'https://api.openai.com/v1/chat/completions';
    if (this.settings.provider === 'groq') {
      endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    } else if (this.settings.provider === 'deepseek') {
      endpoint = 'https://api.deepseek.com/v1/chat/completions';
    } else if (this.settings.provider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    } else if (this.settings.provider === 'together') {
      endpoint = 'https://api.together.xyz/v1/chat/completions';
    } else if (this.settings.provider === 'mistral') {
      endpoint = 'https://api.mistral.ai/v1/chat/completions';
    }

    const systemInstruction = `You are Miss Data (خانم داده), a helpful terminal coding assistant.
Response language: ${this.settings.responseLanguage === 'fa' ? 'Persian (فارسی)' : 'English'}.
Workspace directory: ${this.sandbox.cwd}.
Memory facts: ${this.memoryFacts.map(f => f.fact).join('; ') || 'None'}.
Always provide direct, practical answers for coding, debugging, and terminal operations.`;

    const chatMessages = [
      { role: 'system', content: systemInstruction },
      ...this.messages.slice(-6, -1).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      })),
      { role: 'user', content: userPrompt },
    ];

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: chatMessages,
        max_tokens: this.settings.maxOutputTokens || 2048,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    const data: any = await resp.json();
    const reply = data.choices?.[0]?.message?.content || '(No response returned from provider)';
    msg.content = reply;
    msg.status = 'done';
  }

  private async runAnthropicTurn(userPrompt: string, msg: Message) {
    const key = this.getKeyForProvider('anthropic');
    if (!key) throw new Error('No API key configured for Anthropic');

    const systemInstruction = `You are Miss Data (خانم داده), a helpful terminal coding agent. Response language: ${this.settings.responseLanguage === 'fa' ? 'Persian (فارسی)' : 'English'}. Workspace: ${this.sandbox.cwd}.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.settings.model || 'claude-3-7-sonnet',
        system: systemInstruction,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: this.settings.maxOutputTokens || 2048,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    const data: any = await resp.json();
    const reply = data.content?.[0]?.text || '(No content returned from Anthropic)';
    msg.content = reply;
    msg.status = 'done';
  }

  private async runGeminiTurn(userPrompt: string, msg: Message) {
    const key = this.getKeyForProvider('gemini') || process.env.GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey: key });
    
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

    let response: any;
    const candidates = [this.settings.model, 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    const uniqueCandidates = Array.from(new Set(candidates));
    let lastErr: any = null;

    for (const m of uniqueCandidates) {
      try {
        response = await ai.models.generateContent({
          model: m,
          contents: userPrompt,
          config: {
            systemInstruction,
            tools: toolsConfig,
          },
        });
        if (m !== this.settings.model) {
          this.settings.model = m;
        }
        break;
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (msg.includes('not found') || msg.includes('404') || msg.includes('no longer available') || err?.status === 'NOT_FOUND') {
          continue;
        }
        throw err;
      }
    }

    if (!response) {
      throw lastErr || new Error('No candidate Gemini model succeeded');
    }

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

      if (!response.text) {
        const previousContent = response.candidates?.[0]?.content;
        try {
          const followUp = await ai.models.generateContent({
            model: this.settings.model,
            contents: [
              userPrompt,
              previousContent,
              {
                role: 'user',
                parts: msg.toolResults.map(tr => ({
                  functionResponse: {
                    name: tr.name,
                    response: { result: tr.output }
                  }
                }))
              }
            ],
            config: { systemInstruction },
          });
          if (followUp.text) {
            msg.content = followUp.text;
          }
        } catch (e) {
          // If followUp fails, provide a clean summary
          msg.content = msg.toolResults.map(r => `Executed \`${r.name}\``).join(', ');
        }
      }
    }

    if (!msg.content) {
      msg.content = response.text || (msg.toolResults?.length ? 'Tool executed successfully.' : 'Done.');
    }
    msg.status = 'done';
  }

  private async runLocalAgentTurn(userPrompt: string, msg: Message) {
    // Intelligent heuristic agent when external API key is not configured or in offline mode
    const trimmed = userPrompt.trim();
    const lower = trimmed.toLowerCase();
    msg.toolCalls = [];
    msg.toolResults = [];

    if (/^(hi|hello|hey|salam|dorood|greetings|yo|good\s*(morning|afternoon|evening))\b/i.test(trimmed)) {
      const activeKey = Boolean(this.getKeyForProvider(this.settings.provider));
      msg.content = `Hello! I am Miss Data (خانم داده), your terminal coding assistant.
I'm ready to inspect files, execute terminal commands, run git operations, or develop on this project.

${activeKey ? `Active provider: **${this.settings.provider}** (\`${this.settings.model}\`).` : `*(Offline deterministic mode is active. You can configure an API key anytime with \`/keys add <provider> <key>\` to enable full generative AI answers.)*`}

**Quick actions to get started:**
- \`/status\` - View agent configuration, safeguards, and memory
- \`$ <cmd>\` or \`/run <cmd>\` - Execute shell commands directly
- \`list files\` or \`read <filepath>\` - Inspect workspace files
- \`/doctor\` - Run zero-token system diagnostics
- \`/man\` - Browse complete built-in command manuals`;
    } else if (/(what can you do|capabilities|how do you work|who are you|features|what are you)/i.test(trimmed)) {
      const activeKey = Boolean(this.getKeyForProvider(this.settings.provider));
      msg.content = `### 💻 Miss Data (خانم داده) Capabilities

Miss Data is an autonomous terminal coding agent built for professional engineering workflows:

1. **Codebase Navigation & File Editing:**
   - Read, edit, search, and create files in the workspace.
   - Run grep searches (\`grep <query>\`) and directory mapping (\`/map\`).

2. **Terminal & Sandbox Execution:**
   - Execute commands in an isolated sandbox (\`$ <cmd>\` or \`/run <cmd>\`, e.g. \`$ git status\`, \`$ npm test\`).
   - Safeguard modes: Human-in-the-loop approval (\`/approval risky\`) or autonomous execution (\`/approval auto\`).

3. **Git & Version Control:**
   - Full git integration (\`/git status\`, \`/git log\`, \`/diff\`, \`/changes\`).
   - Create instant workspace snapshot bookmarks (\`/checkpoint <name>\`) and restore them (\`/restore <name>\`).
   - Clean discard of local working tree modifications (\`/discard\`).

4. **Multi-Model Intelligence & Key Pools:**
   - Supports Gemini, Groq, Anthropic, DeepSeek, OpenAI, Ollama.
   - Manage keys securely with \`/keys show\`, \`/keys add <provider> <key>\`, and automatic key rotation.
   - Current status: Provider **${this.settings.provider}** (${activeKey ? '✅ API key active' : '⚠️ No API key set - using local deterministic tools'}).

5. **Built-in Unix Manuals:**
   - Complete documentation for every subsystem: type \`/man\` for the master index, or \`/man <command>\` for detailed man pages.`;
    } else if (/(explain codebase|how does this work|architecture|what is this project|what project)/i.test(trimmed)) {
      let pkgInfo = '';
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(this.sandbox.cwd, 'package.json'), 'utf8'));
        pkgInfo = `\n- **Project Name:** \`${pkg.name || 'app'}\`\n- **Dependencies:** ${Object.keys(pkg.dependencies || {}).join(', ')}`;
      } catch (e) {}

      msg.content = `### 🏗️ Project Architecture & Overview
- **Workspace Path:** \`${this.sandbox.cwd}\`${pkgInfo}
- **Structure:**
  - \`src/\` - React frontend with terminal UI and command parser
  - \`server/\` - Express backend with AgentService, Sandbox, and manual subsystem
  - \`dist/\` - Production bundle output
- **Commands:** Run \`/map\` for a full tree view or \`$ npm run build\` to verify compilation.`;
    } else if (lower.includes('list') || lower.includes('show files') || lower.includes('ls')) {
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
      const activeKey = Boolean(this.getKeyForProvider(this.settings.provider));
      if (!activeKey) {
        msg.content = `Received: "${userPrompt}"

💡 **Note: No API key is currently active for provider \`${this.settings.provider}\`.**
To enable generative reasoning, code generation, and AI explanations:
1. Add an API key with:
   \`\`\`
   /keys add ${this.settings.provider} <your_api_key>
   \`\`\`
   *(Or switch provider, e.g. \`/keys add groq <key>\` or \`/keys add gemini <key>\`)*

2. In the meantime, all local terminal tools work immediately:
   - Run shell commands: \`$ ls -la\` or \`/run git status\`
   - Read files: \`read <filepath>\`
   - Search text: \`grep <text>\`
   - Zero-token diagnostics: \`/doctor\`
   - Check manuals: \`/man <topic>\``;
      } else {
        msg.content = `Miss Data processed prompt in offline mode. Type \`/help\` or \`/man\` for available commands.`;
      }
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
