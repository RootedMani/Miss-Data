import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Check, 
  Copy, 
  Terminal as TerminalIcon, 
  CornerDownLeft, 
  ChevronRight, 
  ChevronDown,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  Activity,
  Cpu,
  X
} from 'lucide-react';
import { Message, AgentStatus, AutocompleteResult } from '../types';
import { terminalSound } from '../lib/sound';

interface TerminalProps {
  messages: Message[];
  status: AgentStatus | null;
  loading: boolean;
  latency?: number | null;
  onSendMessage: (text: string) => void;
  onResolveApproval: (messageId: string, action: 'approve' | 'always' | 'reject') => void;
  onClear: () => void;
  onToggleLanguage?: () => void;
}

const KNOWN_COMMANDS = [
  'clear',
  '/clear',
  '/help',
  '/help status',
  '/help budget',
  '/help doctor',
  '/help git',
  '/help man',
  '/man',
  '/man overview',
  '/man getting-started',
  '/man help',
  '/man man',
  '/man status',
  '/man doctor',
  '/man logs',
  '/man map',
  '/man changes',
  '/man diff',
  '/man cwd',
  '/man test',
  '/man run',
  '/man budget',
  '/man provider',
  '/man model',
  '/man mode',
  '/man lang',
  '/man context',
  '/man approval',
  '/man sandbox',
  '/man privacy',
  '/man git',
  '/man checkpoint',
  '/man checkpoints',
  '/man restore',
  '/man update',
  '/man discard',
  '/man sound',
  '/man metrics',
  '/man statusline',
  '/man clear',
  '/man autocomplete',
  '/man memory',
  '/man forget',
  '/man compact',
  '/man sessions',
  '/man resilience',
  '/man keys',
  '/man ls',
  '/man pwd',
  '/man whoami',
  '/man cat',
  '/man grep',
  '/man find',
  '/man npm',
  '/man node',
  '/man architecture',
  '/man workflows',
  '/man safety',
  '/man troubleshooting',
  '/status',
  '/metrics',
  '/metrics on',
  '/metrics off',
  '/statusline',
  '/statusline on',
  '/statusline off',
  '/doctor',
  '/diff',
  '/changes',
  '/run',
  '/run ls -la',
  '/git',
  '/git status',
  '/git diff',
  '/git log',
  '/discard',
  '/update',
  '/update check',
  '/update apply',
  '/budget',
  '/budget balanced',
  '/budget economy',
  '/budget thorough',
  '/provider',
  '/provider gemini',
  '/provider groq',
  '/provider anthropic',
  '/provider ollama',
  '/model',
  '/mode plan',
  '/mode direct',
  '/approval risky',
  '/approval always',
  '/approval auto',
  '/sandbox on',
  '/sandbox off',
  '/memory',
  '/forget',
  '/compact',
  '/checkpoint',
  '/checkpoints',
  '/restore',
  '/sound',
  '/sound on',
  '/sound off',
  '/lang en',
  '/lang fa',
  '/map',
  '/test',
  '/context',
  '/keys',
  '/resilience',
  '/sessions',
  '/privacy',
  '/logs',
  'ls',
  'ls -la',
  'pwd',
  'whoami',
  'git status',
  'git diff',
  'git log',
  'git branch',
  'git add .',
  'npm run build',
  'npm run lint',
  'npm test',
];

const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Display command index or specific command guide' },
  { cmd: '/man', desc: 'Master categorized index of all built-in Unix manuals' },
  { cmd: '/status', desc: 'Active model, budget, sandbox and safeguards' },
  { cmd: '/metrics', desc: 'Toggle bottom memory & latency status line (on/off)' },
  { cmd: '/statusline', desc: 'Toggle bottom system metrics bar (on/off)' },
  { cmd: '/doctor', desc: 'Zero-cost workspace diagnostics and git checks' },
  { cmd: '/diff', desc: 'Inspect bounded diff of modified files' },
  { cmd: '/changes', desc: 'List files modified in current session' },
  { cmd: '/run', desc: 'Execute a shell command in sandbox (e.g. /run ls -la)' },
  { cmd: '/git', desc: 'Execute git commands (e.g. /git status, /git log)' },
  { cmd: '/clear', desc: 'Clear the terminal screen buffer' },
  { cmd: '/compact', desc: 'Compact older conversation turns into summary' },
  { cmd: '/checkpoint', desc: 'Create instant workspace snapshot bookmark' },
  { cmd: '/checkpoints', desc: 'List all saved workspace snapshots' },
  { cmd: '/restore', desc: 'Restore workspace to a saved snapshot' },
  { cmd: '/discard', desc: 'Discard uncommitted local modifications' },
  { cmd: '/update check', desc: 'Check official repository for updates' },
  { cmd: '/update apply', desc: 'Fast-forward update repository' },
  { cmd: '/budget balanced', desc: 'Set model output cap (economy, balanced, thorough)' },
  { cmd: '/provider', desc: 'Switch LLM backend (gemini, groq, anthropic, ollama)' },
  { cmd: '/model', desc: 'Switch model identifier for active provider' },
  { cmd: '/mode plan', desc: 'Require implementation plan before executing' },
  { cmd: '/mode direct', desc: 'Execute tools directly as requested' },
  { cmd: '/approval risky', desc: 'Safeguard: prompt on state-changing tools' },
  { cmd: '/approval always', desc: 'Safeguard: prompt on every tool execution' },
  { cmd: '/approval auto', desc: 'Autonomous mode: no manual approval prompts' },
  { cmd: '/sandbox on', desc: 'Confine filesystem and block dangerous commands' },
  { cmd: '/sandbox off', desc: 'Disable sandbox confinement' },
  { cmd: '/cwd', desc: 'View or switch working directory' },
  { cmd: '/memory', desc: 'View durable memory facts saved across sessions' },
  { cmd: '/forget', desc: 'Delete durable memory fact by number' },
  { cmd: '/sound', desc: 'Toggle terminal acoustic effects on/off' },
  { cmd: '/lang en', desc: 'Set response language to English' },
  { cmd: '/lang fa', desc: 'Set response language to Persian (فارسی)' },
  { cmd: '/map', desc: 'Map repository structure and test commands' },
  { cmd: '/test', desc: 'Discover and inspect test suites' },
  { cmd: '/context', desc: 'Measure token and character context meter' },
  { cmd: '/keys', desc: 'Manage API key rotation pool' },
  { cmd: '/resilience', desc: 'Configure automatic failover & error recovery' },
  { cmd: '/sessions', desc: 'List and resume saved conversation sessions' },
  { cmd: '/privacy', desc: 'Inspect local storage and scrub data' },
  { cmd: '/logs', desc: 'View redacted activity audit logs' },
  { cmd: '/man status', desc: 'Manual: agent status and diagnostics' },
  { cmd: '/man budget', desc: 'Manual: output token limits' },
  { cmd: '/man sound', desc: 'Manual: retro audio synthesizer' },
  { cmd: '/man metrics', desc: 'Manual: memory and latency status line' },
  { cmd: '/man sandbox', desc: 'Manual: path and command confinement' },
  { cmd: '/man approval', desc: 'Manual: human-in-the-loop safeguards' },
  { cmd: '/man git', desc: 'Manual: version control and diffing' },
  { cmd: '/man checkpoints', desc: 'Manual: workspace snapshots' },
  { cmd: '/man getting-started', desc: 'Manual: introductory guide for beginners' },
  { cmd: '/man architecture', desc: 'Manual: system design and decoupled architecture' },
  { cmd: '/man workflows', desc: 'Manual: recommended engineering practices' },
  { cmd: '/man troubleshooting', desc: 'Manual: common error fixes and diagnostics' },
];

const LOCAL_PROMPT_PATTERNS = [
  { match: /^explain\s*$/i, ghost: ' how this codebase works and its key modules' },
  { match: /^explain\s+how\s*$/i, ghost: ' the terminal sandbox executes commands safely' },
  { match: /^how\s*$/i, ghost: ' do I run shell commands inside the sandbox?' },
  { match: /^how\s+to\s*$/i, ghost: ' execute tests or check git status in the terminal' },
  { match: /^write\s*$/i, ghost: ' a utility function to handle errors cleanly' },
  { match: /^write\s+a\s*$/i, ghost: ' unit test for the terminal command processor' },
  { match: /^fix\s*$/i, ghost: ' any syntax or typing errors in the project' },
  { match: /^fix\s+the\s*$/i, ghost: ' issue where commands need validation' },
  { match: /^refactor\s*$/i, ghost: ' the terminal component for better performance' },
  { match: /^add\s*$/i, ghost: ' a new slash command to inspect active memory' },
  { match: /^check\s*$/i, ghost: ' git status and list uncommitted modifications' },
  { match: /^check\s+if\s*$/i, ghost: ' all dependencies and types build cleanly' },
  { match: /^test\s*$/i, ghost: ' the application build and run the test suite' },
  { match: /^show\s*$/i, ghost: ' me the manual for getting started with Miss Data' },
  { match: /^can\s+you\s*$/i, ghost: ' inspect the repository and explain its architecture?' },
];

export const Terminal: React.FC<TerminalProps> = ({
  messages,
  status,
  loading,
  latency,
  onSendMessage,
  onResolveApproval,
  onClear,
  onToggleLanguage,
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('miss_data_cmd_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback
    }
    const userMsgs = messages
      .filter(m => m.role === 'user')
      .map(m => m.content.trim())
      .filter(Boolean);
    return userMsgs.length > 0 ? userMsgs : ['/help', 'ls -la', '/status'];
  });
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const draftInputRef = useRef<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => terminalSound.isEnabled());
  
  // Status line & metrics toggle (saved in localStorage)
  const [showMetrics, setShowMetrics] = useState<boolean>(() => {
    try {
      return localStorage.getItem('miss_data_statusline_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  const toggleMetrics = (explicit?: boolean) => {
    setShowMetrics(prev => {
      const next = typeof explicit === 'boolean' ? explicit : !prev;
      try {
        localStorage.setItem('miss_data_statusline_enabled', String(next));
      } catch {
        // quota
      }
      return next;
    });
  };

  const formatUptime = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  const latencyColor = 
    latency === null || latency === undefined 
      ? 'text-[#8b949e]' 
      : latency < 120 
        ? 'text-emerald-400' 
        : latency < 300 
          ? 'text-amber-400' 
          : 'text-rose-400';

  const latencyDotColor = 
    latency === null || latency === undefined 
      ? 'bg-[#8b949e]' 
      : latency < 120 
        ? 'bg-emerald-400' 
        : latency < 300 
          ? 'bg-amber-400' 
          : 'bg-rose-400';

  // Autocomplete state
  const [ghostCompletion, setGhostCompletion] = useState<string>('');
  const [ghostType, setGhostType] = useState<'command' | 'prompt' | 'path'>('command');
  const [candidateList, setCandidateList] = useState<string[]>([]);
  const [candidateIndex, setCandidateIndex] = useState<number>(0);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<any>(null);

  // Find any pending approval
  const pendingApprovalMsg = messages.find(m => m.pendingApproval);

  // Filter slash commands for dropdown
  const matchingSlashCommands = input.startsWith('/')
    ? SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().startsWith(input.toLowerCase().trim()))
    : [];

  const prevMessagesLengthRef = useRef(messages.length);

  // Auto-scroll when new messages arrive or loading changes and play sound effect
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

    // Detect new message arrivals to trigger error or success sound
    if (messages.length > prevMessagesLengthRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        const hasErrorTool = lastMsg.toolResults?.some(r => r.isError);
        const hasErrorContent = /\[error\]|error:|fatal:|command not found|exit [1-9]|permission denied/i.test(lastMsg.content);
        
        if (hasErrorTool || hasErrorContent) {
          terminalSound.playCommandError();
        } else {
          terminalSound.playCommandSuccess();
        }
      }
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages, loading]);

  // Focus input automatically on mount and clicks
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleContainerClick = () => {
    const selection = window.getSelection();
    if (!selection || selection.toString().length === 0) {
      inputRef.current?.focus();
    }
  };

  // Instant local completion resolver
  const resolveLocalCompletion = useCallback((val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      return { ghost: '', candidates: [], type: 'command' as const };
    }

    const lower = trimmed.toLowerCase();

    // 1. Check known commands (clear, /lang, /status, etc.)
    const matches = KNOWN_COMMANDS.filter(cmd => cmd.toLowerCase().startsWith(lower));
    if (matches.length > 0) {
      const best = matches[0];
      const ghost = best.slice(trimmed.length);
      return { ghost, candidates: matches, type: 'command' as const };
    }

    // 2. Check local Google AI Studio style prompt patterns
    for (const p of LOCAL_PROMPT_PATTERNS) {
      if (p.match.test(trimmed)) {
        return { ghost: p.ghost, candidates: [val + p.ghost], type: 'prompt' as const };
      }
    }

    return { ghost: '', candidates: [], type: 'command' as const };
  }, []);

  // Compute autocompletions when input changes
  const updateAutocomplete = useCallback((val: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = val.trim();
    if (!trimmed) {
      setGhostCompletion('');
      setCandidateList([]);
      setCandidateIndex(0);
      setAutocompleteOpen(false);
      return;
    }

    // Instant local check first (0ms latency)
    const local = resolveLocalCompletion(val);
    setGhostCompletion(local.ghost);
    setCandidateList(local.candidates);
    setGhostType(local.type);
    setCandidateIndex(0);

    // If typing a slash command, open slash menu
    if (val.startsWith('/') && matchingSlashCommands.length > 0) {
      setAutocompleteOpen(true);
      setAutocompleteIndex(0);
    } else {
      setAutocompleteOpen(false);
    }

    // Debounce background server call for AI prompt or path completions
    if (trimmed.length >= 3) {
      debounceTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetch('/api/autocomplete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix: val }),
          });
          if (!res.ok) return;
          const data: AutocompleteResult = await res.json();
          // Ensure input hasn't changed since request was initiated
          if (inputRef.current && inputRef.current.value === val && data.completion) {
            setGhostCompletion(data.completion);
            setGhostType(data.type);
            if (data.candidates && data.candidates.length > 0) {
              setCandidateList(data.candidates);
            }
          }
        } catch {
          // Ignore network errors
        }
      }, 120);
    }
  }, [resolveLocalCompletion, matchingSlashCommands.length]);

  const executeCommand = (cmdText: string) => {
    const trimmed = cmdText.trim();
    if (!trimmed) return;

    // Check if user is responding to an approval prompt
    if (pendingApprovalMsg) {
      const lower = trimmed.toLowerCase();
      if (lower === 'y' || lower === 'yes' || lower === 'approve') {
        onResolveApproval(pendingApprovalMsg.id, 'approve');
        setInput('');
        setGhostCompletion('');
        return;
      }
      if (lower === 'a' || lower === 'always') {
        onResolveApproval(pendingApprovalMsg.id, 'always');
        setInput('');
        setGhostCompletion('');
        return;
      }
      if (lower === 'n' || lower === 'no' || lower === 'reject') {
        onResolveApproval(pendingApprovalMsg.id, 'reject');
        setInput('');
        setGhostCompletion('');
        return;
      }
    }

    // Add to history (avoid duplicates at the top, max 100 entries)
    setHistory(prev => {
      const next = prev[prev.length - 1] === trimmed ? prev : [...prev, trimmed].slice(-100);
      try {
        localStorage.setItem('miss_data_cmd_history', JSON.stringify(next));
      } catch {
        // Storage quota
      }
      return next;
    });

    setHistoryIndex(-1);
    draftInputRef.current = '';
    setInput('');
    setGhostCompletion('');
    setCandidateList([]);
    setAutocompleteOpen(false);

    // Direct clear
    if (trimmed === 'clear' || trimmed === '/clear') {
      terminalSound.playCommandExecute();
      onClear();
      return;
    }

    // Direct sound toggle
    if (trimmed === '/sound' || trimmed === '/sound toggle') {
      const next = terminalSound.toggleSound();
      setSoundEnabled(next);
      return;
    }
    if (trimmed === '/sound on') {
      if (!terminalSound.isEnabled()) {
        terminalSound.toggleSound();
      }
      setSoundEnabled(true);
      terminalSound.playTabComplete();
      return;
    }
    if (trimmed === '/sound off') {
      if (terminalSound.isEnabled()) {
        terminalSound.toggleSound();
      }
      setSoundEnabled(false);
      return;
    }

    // Direct metrics / statusline toggle
    if (trimmed === '/metrics' || trimmed === '/metrics toggle' || trimmed === '/statusline' || trimmed === '/statusline toggle') {
      toggleMetrics();
      terminalSound.playTabComplete();
      return;
    }
    if (trimmed === '/metrics on' || trimmed === '/statusline on') {
      toggleMetrics(true);
      terminalSound.playTabComplete();
      return;
    }
    if (trimmed === '/metrics off' || trimmed === '/statusline off') {
      toggleMetrics(false);
      return;
    }

    terminalSound.playCommandExecute();
    onSendMessage(trimmed);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    executeCommand(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Autocomplete dropdown navigation (for slash commands popup)
    if (autocompleteOpen && matchingSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIndex(prev => (prev + 1) % matchingSlashCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIndex(prev => (prev - 1 + matchingSlashCommands.length) % matchingSlashCommands.length);
        return;
      }
      if (e.key === 'Escape') {
        setAutocompleteOpen(false);
        return;
      }
    }

    // TAB COMPLETION & GHOST ACCEPTANCE
    if (e.key === 'Tab') {
      e.preventDefault();

      // Case A: Slash command menu is active
      if (autocompleteOpen && matchingSlashCommands.length > 0) {
        const selected = matchingSlashCommands[autocompleteIndex];
        if (selected) {
          terminalSound.playTabComplete();
          setInput(selected.cmd);
          setGhostCompletion('');
          setAutocompleteOpen(false);
          updateAutocomplete(selected.cmd);
        }
        return;
      }

      // Case B: Ghost text is visible (Google AI Studio prompt or known command)
      if (ghostCompletion) {
        terminalSound.playTabComplete();
        const full = input + ghostCompletion;
        setInput(full);
        setGhostCompletion('');
        setAutocompleteOpen(false);
        updateAutocomplete(full);
        return;
      }

      // Case C: Multiple candidate cycling on repeated Tab (e.g. /lang -> /lang en -> /lang fa)
      if (candidateList.length > 0) {
        terminalSound.playTabComplete();
        const nextIndex = (candidateIndex + 1) % candidateList.length;
        const candidate = candidateList[nextIndex];
        setCandidateIndex(nextIndex);
        setInput(candidate);
        setGhostCompletion('');
        return;
      }

      // Case D: Try on-the-fly local completion resolution
      const local = resolveLocalCompletion(input);
      if (local.ghost) {
        terminalSound.playTabComplete();
        const full = input + local.ghost;
        setInput(full);
        setGhostCompletion('');
        updateAutocomplete(full);
        return;
      }
      return;
    }

    // RIGHT ARROW: Also accept ghost completion if cursor is at the end of the text
    if (e.key === 'ArrowRight' && ghostCompletion) {
      const el = inputRef.current;
      if (el && el.selectionStart === input.length && el.selectionEnd === input.length) {
        e.preventDefault();
        terminalSound.playTabComplete();
        const full = input + ghostCompletion;
        setInput(full);
        setGhostCompletion('');
        updateAutocomplete(full);
        return;
      }
    }

    // COMMAND HISTORY NAVIGATION (Up / Down arrows)
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;

      if (historyIndex === -1) {
        draftInputRef.current = input;
      }

      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      const recalled = history[nextIndex];
      setInput(recalled);
      setGhostCompletion('');
      setAutocompleteOpen(false);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = inputRef.current.selectionEnd = recalled.length;
        }
      }, 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;

      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        const restored = draftInputRef.current;
        setInput(restored);
        setGhostCompletion('');
        setAutocompleteOpen(false);
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = inputRef.current.selectionEnd = restored.length;
          }
        }, 0);
      } else {
        setHistoryIndex(nextIndex);
        const recalled = history[nextIndex];
        setInput(recalled);
        setGhostCompletion('');
        setAutocompleteOpen(false);
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = inputRef.current.selectionEnd = recalled.length;
          }
        }, 0);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      onClear();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    updateAutocomplete(val);
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const toggleTool = (id: string) => {
    setExpandedTools(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const textSize = fontSize === 'sm' ? 'text-xs' : fontSize === 'base' ? 'text-sm' : 'text-base';

  return (
    <div 
      ref={terminalContainerRef}
      onClick={handleContainerClick}
      className={`flex flex-col h-screen w-screen bg-[#0a0c10] text-[#c9d1d9] font-mono select-text cursor-text ${textSize}`}
    >
      {/* Authentic Terminal Title Bar */}
      <header className="h-10 bg-[#161b22] border-b border-[#30363d] px-4 flex items-center justify-between shrink-0 select-none cursor-default">
        {/* Left: Window Controls */}
        <div className="flex items-center space-x-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block border border-[#e0443e]" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block border border-[#dea123]" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block border border-[#1aab29]" />
          <span className="ml-3 text-xs text-[#8b949e] font-semibold flex items-center gap-1.5">
            <TerminalIcon size={13} className="text-emerald-400" />
            <span>miss-data — zsh (coding agent)</span>
          </span>
        </div>

        {/* Center: Current Workspace Directory */}
        <div className="hidden md:flex items-center space-x-1.5 text-xs text-[#8b949e]">
          <span className="text-emerald-400">~/workspace</span>
          <span>•</span>
          <span className="text-[#58a6ff]">{status?.provider || 'local'}:{status?.model || 'default'}</span>
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center space-x-2 text-xs">
          {onToggleLanguage && (
            <button
              onClick={onToggleLanguage}
              className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-[11px] transition-colors"
              title="Toggle response language"
            >
              {status?.responseLanguage === 'fa' ? 'فارسی' : 'EN'}
            </button>
          )}

          <div className="flex items-center rounded bg-[#21262d] border border-[#30363d] text-[11px] overflow-hidden">
            <button
              onClick={() => setFontSize('sm')}
              className={`px-1.5 py-0.5 ${fontSize === 'sm' ? 'bg-[#388bfd] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              title="Small font"
            >
              A-
            </button>
            <button
              onClick={() => setFontSize('base')}
              className={`px-1.5 py-0.5 ${fontSize === 'base' ? 'bg-[#388bfd] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              title="Normal font"
            >
              A
            </button>
            <button
              onClick={() => setFontSize('lg')}
              className={`px-1.5 py-0.5 ${fontSize === 'lg' ? 'bg-[#388bfd] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              title="Large font"
            >
              A+
            </button>
          </div>

          <button
            onClick={() => {
              const next = terminalSound.toggleSound();
              setSoundEnabled(next);
            }}
            className={`px-2 py-0.5 rounded border border-[#30363d] text-[11px] transition-colors flex items-center gap-1 ${
              soundEnabled 
                ? 'bg-[#21262d] text-emerald-400 hover:bg-[#30363d]' 
                : 'bg-[#161b22] text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
            title={`Terminal audio effects: ${soundEnabled ? 'Enabled' : 'Muted'} (type /sound to toggle)`}
          >
            {soundEnabled ? <Volume2 size={11} className="text-emerald-400" /> : <VolumeX size={11} />}
            <span>{soundEnabled ? 'FX' : 'Mute'}</span>
          </button>

          <button
            onClick={() => toggleMetrics()}
            className={`px-2 py-0.5 rounded border border-[#30363d] text-[11px] transition-colors flex items-center gap-1 ${
              showMetrics 
                ? 'bg-[#21262d] text-[#58a6ff] hover:bg-[#30363d]' 
                : 'bg-[#161b22] text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
            title={`System metrics status line: ${showMetrics ? 'Visible' : 'Hidden'} (click to toggle or type /metrics)`}
          >
            <Activity size={11} className={showMetrics ? 'text-[#58a6ff]' : ''} />
            <span>Sys</span>
          </button>

          <button
            onClick={onClear}
            className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] border border-[#30363d] text-[11px] transition-colors flex items-center gap-1"
            title="Clear screen (Ctrl+L)"
          >
            <RotateCcw size={10} />
            <span>^L</span>
          </button>
        </div>
      </header>

      {/* Terminal Scrollback Buffer */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 font-mono leading-relaxed">
        {/* Welcome ASCII Banner */}
        <div className="text-emerald-400/90 whitespace-pre font-mono text-[11px] sm:text-xs select-none leading-none pt-1">
{`  __  __ _            ____        _        
 |  \\/  (_)___ ___   |  _ \\  __ _| |_ __ _ 
 | |\\/| | / __/ __|  | | | |/ _\` | __/ _\` |
 | |  | | \\__ \\__ \\  | |_| | (_| | || (_| |
 |_|  |_|_|___/___/  |____/ \\__,_|\\__\\__,_|`}
        </div>
        <div className="border-b border-[#30363d]/70 pb-3 text-xs text-[#8b949e] space-y-1">
          <div className="text-[#f0f6fc] font-semibold">
            Miss Data (خانم داده) v1.0.0 — Terminal Coding Agent
          </div>
          <div className="text-[#8b949e]">
            Sandbox: <span className="text-emerald-400">active</span> | 
            Provider: <span className="text-[#58a6ff]">{status?.provider || 'local'}</span> | 
            Working Directory: <span className="text-amber-300">~/workspace</span>
          </div>
          <div className="text-[11px] text-[#7d8590] pt-1">
            Type <span className="text-[#58a6ff]">/help</span> for commands, <span className="text-[#7ee787]">$ &lt;command&gt;</span> for shell execution, or enter any coding prompt.
            Press <span className="text-emerald-300 font-semibold">Tab ⇥</span> to autocomplete commands & prompts.
          </div>
        </div>

        {/* Message Log */}
        {messages.map((msg, index) => (
          <div key={msg.id || index} className="space-y-1.5">
            {/* User Command Line */}
            {msg.role === 'user' && (
              <div className="flex items-start space-x-2 pt-1">
                <span className="text-emerald-400 select-none font-bold shrink-0">miss-data ❯</span>
                <span className="text-[#f0f6fc] font-medium break-words whitespace-pre-wrap">{msg.content}</span>
              </div>
            )}

            {/* Assistant Output */}
            {msg.role === 'assistant' && (
              <div className="space-y-2 py-0.5 ml-1">
                {/* Tool Executions as Terminal Logs */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1 my-1">
                    {msg.toolCalls.map(call => {
                      const result = msg.toolResults?.find(r => r.toolCallId === call.id || r.name === call.name);
                      const isExpanded = expandedTools[call.id] || false;

                      return (
                        <div key={call.id} className="border border-[#30363d] rounded bg-[#161b22]/70 text-xs overflow-hidden">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleTool(call.id); }}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[#21262d] text-left transition-colors"
                          >
                            <div className="flex items-center space-x-2 truncate pr-2">
                              {isExpanded ? <ChevronDown size={12} className="text-[#8b949e]" /> : <ChevronRight size={12} className="text-[#8b949e]" />}
                              <span className="text-[#a371f7] font-semibold">[{call.name}]</span>
                              <span className="text-[#8b949e] font-mono text-[11px] truncate">
                                {Object.entries(call.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}
                              </span>
                            </div>
                            <div className="shrink-0 text-[11px]">
                              {result ? (
                                result.isError ? (
                                  <span className="text-rose-400 font-semibold">exit 1</span>
                                ) : (
                                  <span className="text-emerald-400 font-semibold">exit 0</span>
                                )
                              ) : (
                                <span className="text-amber-400 animate-pulse font-semibold">running...</span>
                              )}
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="p-2.5 bg-[#0a0c10] border-t border-[#30363d] text-[11px] font-mono max-h-52 overflow-y-auto whitespace-pre-wrap text-[#c9d1d9]">
                              {result ? result.output : 'Executing tool action...'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Inline Authorization Prompt */}
                {msg.pendingApproval && (
                  <div className="border border-amber-500/70 bg-[#251b0a] rounded p-3 my-2 space-y-2 text-xs">
                    <div className="flex items-center space-x-2 text-amber-300 font-semibold">
                      <AlertTriangle size={15} />
                      <span>AUTHORIZATION REQUIRED</span>
                    </div>
                    <div className="text-[#c9d1d9] font-mono">
                      {msg.pendingApproval.description}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onResolveApproval(msg.id, 'approve'); }}
                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
                      >
                        [y] Approve
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onResolveApproval(msg.id, 'always'); }}
                        className="px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-amber-300 border border-[#30363d] transition-colors"
                      >
                        [a] Always Approve
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onResolveApproval(msg.id, 'reject'); }}
                        className="px-2.5 py-1 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 transition-colors"
                      >
                        [n] Reject
                      </button>
                      <span className="text-[11px] text-[#8b949e]">
                        (or type y / a / n in prompt)
                      </span>
                    </div>
                  </div>
                )}

                {/* Response Text */}
                {msg.content && (
                  <div className="relative group">
                    <div className="whitespace-pre-wrap leading-relaxed text-[#c9d1d9] break-words">
                      {msg.content}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); copyText(msg.content, msg.id); }}
                      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] transition-opacity"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Processing Indicator */}
        {loading && (
          <div className="flex items-center space-x-2 text-[#58a6ff] text-xs pt-1">
            <span className="animate-spin inline-block">◐</span>
            <span>processing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Autocomplete Popup (For Slash Commands) */}
      {autocompleteOpen && matchingSlashCommands.length > 0 && (
        <div className="mx-4 mb-1 bg-[#161b22] border border-[#30363d] rounded shadow-2xl overflow-hidden max-h-48 overflow-y-auto shrink-0 z-20">
          <div className="px-2.5 py-1 bg-[#21262d] border-b border-[#30363d] text-[10px] text-[#8b949e] flex justify-between items-center">
            <span>Slash Commands (Tab ⇥ to select)</span>
            <span>{matchingSlashCommands.length} match(es)</span>
          </div>
          {matchingSlashCommands.map((c, i) => (
            <div
              key={c.cmd}
              onClick={(e) => {
                e.stopPropagation();
                setInput(c.cmd);
                setGhostCompletion('');
                setAutocompleteOpen(false);
                inputRef.current?.focus();
              }}
              onMouseEnter={() => setAutocompleteIndex(i)}
              className={`px-3 py-1 flex items-center justify-between cursor-pointer text-xs ${
                i === autocompleteIndex ? 'bg-[#388bfd]/20 text-[#58a6ff]' : 'text-[#c9d1d9] hover:bg-[#21262d]'
              }`}
            >
              <span className="font-semibold">{c.cmd}</span>
              <span className="text-[11px] text-[#8b949e]">{c.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Terminal Input Line with AI Studio Ghost Autocomplete */}
      <div className="border-t border-[#30363d] bg-[#0d1117] p-3 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <span className="text-emerald-400 font-bold select-none text-sm shrink-0">
            {pendingApprovalMsg ? '[y/a/n] ❯' : 'miss-data ❯'}
          </span>

          <div className="relative flex-1 flex items-center min-w-0">
            {/* Ghost text background overlay (Google AI Studio style) */}
            <div 
              aria-hidden="true"
              className="absolute inset-0 flex items-center pointer-events-none select-none font-mono text-sm whitespace-pre overflow-hidden leading-normal"
            >
              {/* Invisible spacer matching the typed text */}
              <span className="opacity-0">{input}</span>

              {/* Ghost suggestion suffix */}
              {ghostCompletion && (
                <span className="text-[#6e7681] flex items-center shrink-0">
                  <span className="italic">{ghostCompletion}</span>
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-[#8b949e] bg-[#1c2128] px-1.5 py-0.5 rounded border border-[#30363d] font-sans">
                    {ghostType === 'prompt' && <Sparkles size={10} className="text-amber-400" />}
                    <span>Tab ⇥</span>
                  </span>
                </span>
              )}
            </div>

            {/* Actual transparent input in foreground */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                pendingApprovalMsg
                  ? "Approve risky action? Type y (approve), a (always), or n (reject)..."
                  : "Type request, command (clear, /lang, ls, git), or coding prompt..."
              }
              disabled={loading}
              className="relative z-10 w-full bg-transparent border-none outline-none text-[#f0f6fc] placeholder-[#8b949e]/60 font-mono text-sm caret-emerald-400"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] disabled:opacity-30 text-[#8b949e] hover:text-[#c9d1d9] border border-[#30363d] transition-colors text-xs flex items-center gap-1 select-none shrink-0"
            title="Execute (Enter)"
          >
            <span>Enter</span>
            <CornerDownLeft size={11} />
          </button>
        </form>

        {/* Tmux-style Statusline */}
        <div className="flex justify-between items-center text-[10px] text-[#8b949e] mt-2 pt-1 border-t border-[#21262d] select-none">
          <div className="flex items-center space-x-3">
            <span className="text-emerald-400 font-semibold">[CLI READY]</span>
            <span>history: {history.length}</span>
            <span>↑↓ history</span>
            <span className="text-[#58a6ff] font-medium">Tab / → autocomplete</span>
            <span>^L clear</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => toggleMetrics()}
              className="hover:text-[#c9d1d9] transition-colors"
              title="Click to toggle memory & latency status line (or type /metrics)"
            >
              metrics: <span className={showMetrics ? 'text-[#58a6ff]' : 'text-[#8b949e]'}>{showMetrics ? 'on' : 'off'}</span>
            </button>
            <span>•</span>
            <button
              onClick={() => {
                const next = terminalSound.toggleSound();
                setSoundEnabled(next);
              }}
              className="hover:text-[#c9d1d9] transition-colors"
              title="Click to toggle sound"
            >
              sound: <span className={soundEnabled ? 'text-emerald-400' : 'text-[#8b949e]'}>{soundEnabled ? 'on' : 'off'}</span>
            </button>
            <span>•</span>
            <span>sandbox: <span className="text-[#7ee787]">{status?.sandboxMode ? 'on' : 'off'}</span></span>
            <span>•</span>
            <span>approval: <span className="text-amber-400">{status?.approvalMode || 'risky'}</span></span>
          </div>
        </div>
      </div>

      {/* Small, non-intrusive Memory & Latency Status Line at the bottom */}
      {showMetrics && (
        <div 
          id="terminal-system-statusline"
          className="bg-[#090d13] border-t border-[#21262d] px-3 py-1 flex items-center justify-between text-[11px] font-mono text-[#8b949e] select-none shrink-0"
        >
          {/* Left: Memory and Latency indicators */}
          <div className="flex items-center space-x-3 min-w-0 overflow-hidden">
            {/* Memory Usage */}
            <div className="flex items-center space-x-1.5 shrink-0" title="Node.js Process Memory Usage (Heap & RSS)">
              <Cpu size={12} className="text-[#58a6ff]" />
              <span className="text-[#8b949e] font-semibold">MEM:</span>
              <span className="text-[#f0f6fc]">
                {status?.systemMetrics?.heapUsedMB !== undefined ? `${status.systemMetrics.heapUsedMB} MB` : '42.1 MB'}
              </span>
              {status?.systemMetrics?.heapTotalMB !== undefined && (
                <span className="text-[#6e7681]">/ {status.systemMetrics.heapTotalMB} MB</span>
              )}
              {status?.systemMetrics?.rssMB !== undefined && (
                <span className="text-[#6e7681] text-[10px] hidden sm:inline">
                  (RSS: {status.systemMetrics.rssMB} MB)
                </span>
              )}
            </div>

            <span className="text-[#30363d]">•</span>

            {/* System Latency / Ping */}
            <div className="flex items-center space-x-1.5 shrink-0" title="API Round-trip Response Latency">
              <Activity size={12} className={latencyColor} />
              <span className="text-[#8b949e] font-semibold">PING:</span>
              <span className={`font-semibold ${latencyColor}`}>
                {latency !== null && latency !== undefined ? `${latency} ms` : 'healthy'}
              </span>
              <span className={`w-1.5 h-1.5 rounded-full ${latencyDotColor} animate-pulse`} />
            </div>

            {/* Process Uptime */}
            {status?.systemMetrics?.uptimeSec !== undefined && (
              <>
                <span className="text-[#30363d] hidden md:inline">•</span>
                <span className="text-[#6e7681] text-[10px] hidden md:inline" title="Process Uptime">
                  UP: {formatUptime(status.systemMetrics.uptimeSec)}
                </span>
              </>
            )}
          </div>

          {/* Right: Hide / Turn Off Button */}
          <div className="flex items-center space-x-2 shrink-0">
            <span className="text-[10px] text-[#6e7681] hidden lg:inline">(/metrics off)</span>
            <button
              id="hide-statusline-btn"
              onClick={() => toggleMetrics(false)}
              className="px-1.5 py-0.5 rounded text-[#6e7681] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors flex items-center gap-1 text-[10px]"
              title="Turn off status line (toggle back via 'metrics: off' in status bar or /metrics)"
            >
              <span>hide</span>
              <X size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
