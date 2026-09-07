import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Terminal as TerminalIcon, 
  ShieldAlert, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Copy, 
  Check, 
  FileText, 
  ChevronRight, 
  ChevronDown, 
  AlertTriangle,
  Play,
  Download,
  RotateCcw,
  Sparkles,
  Zap,
  Languages,
  Activity,
  GitBranch,
  Layers,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { Message, AgentStatus, ToolCall, ToolResult } from '../types';

interface TerminalProps {
  messages: Message[];
  status: AgentStatus | null;
  loading: boolean;
  onSendMessage: (text: string) => void;
  onResolveApproval: (messageId: string, action: 'approve' | 'always' | 'reject') => void;
  onClear: () => void;
  onOpenGitPanel?: () => void;
  onOpenShell?: () => void;
}

export const Terminal: React.FC<TerminalProps> = ({
  messages,
  status,
  loading,
  onSendMessage,
  onResolveApproval,
  onClear,
  onOpenGitPanel,
  onOpenShell,
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('sm');
  const [activeCategory, setActiveCategory] = useState<'all' | 'git' | 'diagnostics' | 'workflows' | 'config'>('all');
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allSlashCommands = [
    { cmd: '/update check', desc: 'Check trusted repository for updates', cat: 'git' },
    { cmd: '/update apply', desc: 'Fast-forward checkout from official remote', cat: 'git' },
    { cmd: '/discard', desc: 'Discard uncommitted local modifications & untracked files', cat: 'git' },
    { cmd: '/diff', desc: 'Inspect bounded diff of modified files', cat: 'git' },
    { cmd: '/checkpoints', desc: 'List local saved checkpoint commits', cat: 'git' },
    { cmd: '/status', desc: 'Active model, budget, sandbox and safeguards', cat: 'diagnostics' },
    { cmd: '/doctor', desc: 'Run zero-token repository & connection health checks', cat: 'diagnostics' },
    { cmd: '/context', desc: 'Character and token consumption meter', cat: 'diagnostics' },
    { cmd: '/map', desc: 'Map repository structure and test commands', cat: 'workflows' },
    { cmd: '/test', desc: 'Discover and inspect test suites', cat: 'workflows' },
    { cmd: '/mode plan', desc: 'Require plan review before tools can make edits', cat: 'workflows' },
    { cmd: '/mode direct', desc: 'Allow direct tool modifications without plan step', cat: 'workflows' },
    { cmd: '/memory', desc: 'View durable memory facts saved across sessions', cat: 'config' },
    { cmd: '/lang fa', desc: 'Switch response language to Persian (فارسی)', cat: 'config' },
    { cmd: '/lang en', desc: 'Switch response language to English', cat: 'config' },
    { cmd: '/compact', desc: 'Compact older conversation history into note', cat: 'diagnostics' },
    { cmd: '/clear', desc: 'Clear conversation turns', cat: 'diagnostics' },
    { cmd: '/man update', desc: 'Open updater and git guide', cat: 'git' },
    { cmd: '/man getting-started', desc: 'Open getting started guide', cat: 'workflows' },
  ];

  const matchingCommands = input.startsWith('/')
    ? allSlashCommands.filter(c => c.cmd.toLowerCase().startsWith(input.toLowerCase().trim()))
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setHistory(prev => [...prev, text]);
    setHistoryIndex(-1);
    setInput('');
    setAutocompleteOpen(false);
    onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (autocompleteOpen && matchingCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIndex(prev => (prev + 1) % matchingCommands.length);
        return;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIndex(prev => (prev - 1 + matchingCommands.length) % matchingCommands.length);
        return;
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selected = matchingCommands[autocompleteIndex];
        if (selected) {
          setInput(selected.cmd);
          setAutocompleteOpen(false);
        }
        return;
      } else if (e.key === 'Escape') {
        setAutocompleteOpen(false);
        return;
      }
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
    } else if (e.key === 'Tab' && input.startsWith('/')) {
      e.preventDefault();
      if (matchingCommands.length > 0) {
        setInput(matchingCommands[0].cmd);
      }
    }
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    if (val.startsWith('/') && val.length > 0) {
      setAutocompleteOpen(true);
      setAutocompleteIndex(0);
    } else {
      setAutocompleteOpen(false);
    }
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportTranscript = () => {
    const transcript = messages
      .map(m => `### [${m.role.toUpperCase()}] ${new Date(m.timestamp).toLocaleTimeString()}\n\n${m.content}\n\n`)
      .join('\n---\n\n');
    const blob = new Blob([transcript], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `miss-data-transcript-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleTool = (id: string) => {
    setExpandedTools(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const fontSizeClass = fontSize === 'sm' ? 'text-xs' : fontSize === 'base' ? 'text-sm' : 'text-base';

  return (
    <div className={`flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] font-mono ${fontSizeClass}`}>
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Welcome & Command Center Header */}
        <div className="border border-[#30363d] bg-[#161b22] rounded-xl p-4 mb-3 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#30363d] pb-2.5 mb-3 gap-2">
            <div className="flex items-center space-x-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-bold text-emerald-400 text-sm">Miss Data (خانم داده)</span>
              <span className="text-xs text-[#8b949e]">Terminal Coding Agent</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setFontSize(f => f === 'sm' ? 'base' : f === 'base' ? 'lg' : 'sm')}
                className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] text-[11px] border border-[#30363d]"
                title="Toggle terminal font size"
              >
                Font: {fontSize.toUpperCase()}
              </button>
              {onOpenShell && (
                <button
                  onClick={onOpenShell}
                  className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#7ee787] text-[11px] border border-[#30363d] flex items-center space-x-1"
                  title="Open direct sandbox shell"
                >
                  <TerminalIcon size={11} />
                  <span>Direct Shell</span>
                </button>
              )}
              {onOpenGitPanel && (
                <button
                  onClick={onOpenGitPanel}
                  className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] text-[11px] border border-[#30363d] flex items-center space-x-1"
                  title="Open Git & Updates Manager"
                >
                  <GitBranch size={11} />
                  <span>Git Manager</span>
                </button>
              )}
              <button
                onClick={exportTranscript}
                disabled={messages.length === 0}
                className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] text-[11px] border border-[#30363d] disabled:opacity-40"
                title="Download conversation transcript as Markdown"
              >
                <Download size={11} />
              </button>
            </div>
          </div>

          <p className="text-xs text-[#8b949e] mb-3 leading-relaxed">
            Execute requests in natural language or run zero-token slash commands for local workflows, Git sync, code inspection, and memory management.
          </p>

          {/* Quick-Command Categories Toolbar */}
          <div className="space-y-2">
            <div className="flex items-center space-x-1 border-b border-[#30363d]/60 pb-1.5 text-[11px]">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-2 py-0.5 rounded ${activeCategory === 'all' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                Featured
              </button>
              <button
                onClick={() => setActiveCategory('git')}
                className={`px-2 py-0.5 rounded ${activeCategory === 'git' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                ⚡ Git & Updates
              </button>
              <button
                onClick={() => setActiveCategory('diagnostics')}
                className={`px-2 py-0.5 rounded ${activeCategory === 'diagnostics' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                🩺 Diagnostics
              </button>
              <button
                onClick={() => setActiveCategory('workflows')}
                className={`px-2 py-0.5 rounded ${activeCategory === 'workflows' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                🛠️ Workflows
              </button>
              <button
                onClick={() => setActiveCategory('config')}
                className={`px-2 py-0.5 rounded ${activeCategory === 'config' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'}`}
              >
                ⚙️ Config & Lang
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs">
              {(activeCategory === 'all' || activeCategory === 'git') && (
                <>
                  <button 
                    onClick={() => onSendMessage('/update check')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#7ee787] border border-[#30363d] transition-colors"
                  >
                    /update check
                  </button>
                  <button 
                    onClick={() => onSendMessage('/update apply')}
                    className="px-2 py-1 rounded bg-[#238636]/30 hover:bg-[#238636]/50 text-[#7ee787] border border-emerald-600/40 transition-colors font-semibold"
                  >
                    /update apply
                  </button>
                  <button 
                    onClick={() => onSendMessage('/discard')}
                    className="px-2 py-1 rounded bg-rose-950/40 hover:bg-rose-950/70 text-rose-300 border border-rose-800/40 transition-colors"
                    title="Discards local modifications & untracked files"
                  >
                    /discard
                  </button>
                  <button 
                    onClick={() => onSendMessage('/diff')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
                  >
                    /diff
                  </button>
                </>
              )}

              {(activeCategory === 'all' || activeCategory === 'diagnostics') && (
                <>
                  <button 
                    onClick={() => onSendMessage('/status')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
                  >
                    /status
                  </button>
                  <button 
                    onClick={() => onSendMessage('/doctor')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-amber-300 border border-[#30363d] transition-colors"
                  >
                    /doctor
                  </button>
                  <button 
                    onClick={() => onSendMessage('/context')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] border border-[#30363d] transition-colors"
                  >
                    /context
                  </button>
                </>
              )}

              {(activeCategory === 'all' || activeCategory === 'workflows') && (
                <>
                  <button 
                    onClick={() => onSendMessage('/map')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] transition-colors"
                  >
                    /map
                  </button>
                  <button 
                    onClick={() => onSendMessage('/test')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] transition-colors"
                  >
                    /test
                  </button>
                  <button 
                    onClick={() => onSendMessage('/man getting-started')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
                  >
                    /man getting-started
                  </button>
                </>
              )}

              {(activeCategory === 'all' || activeCategory === 'config') && (
                <>
                  <button 
                    onClick={() => onSendMessage('/lang fa')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] border border-[#30363d] transition-colors"
                  >
                    فارسی (/lang fa)
                  </button>
                  <button 
                    onClick={() => onSendMessage('/memory')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] transition-colors"
                  >
                    /memory
                  </button>
                  <button 
                    onClick={() => onSendMessage('/budget balanced')}
                    className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] border border-[#30363d] transition-colors"
                  >
                    /budget balanced
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Message Thread */}
        {messages.map((msg, index) => (
          <div key={msg.id || index} className="space-y-1.5">
            {/* User Message */}
            {msg.role === 'user' && (
              <div className="flex items-start space-x-2 pt-2">
                <span className="text-emerald-400 font-bold select-none text-xs shrink-0 mt-0.5">You ›</span>
                <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-[#f0f6fc] text-xs font-mono max-w-3xl leading-relaxed">
                  {msg.content}
                </div>
              </div>
            )}

            {/* Assistant / Miss Data Message */}
            {msg.role === 'assistant' && (
              <div className="border-l-2 border-emerald-500/80 pl-3 py-1 space-y-2 ml-1">
                <div className="flex items-center justify-between text-xs text-[#8b949e]">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-emerald-400">Miss Data ›</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                    {msg.status === 'thinking' && (
                      <span className="text-amber-400 animate-pulse text-[11px]">(processing turn)</span>
                    )}
                  </div>
                  <button
                    onClick={() => copyText(msg.content, msg.id)}
                    className="hover:text-[#c9d1d9] flex items-center space-x-1 p-1"
                    title="Copy response"
                  >
                    {copiedId === msg.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </div>

                {/* Tool Calls Accordion */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1.5 my-2">
                    {msg.toolCalls.map(call => {
                      const result = msg.toolResults?.find(r => r.toolCallId === call.id || r.name === call.name);
                      const isExpanded = expandedTools[call.id] || false;

                      return (
                        <div key={call.id} className="border border-[#30363d] rounded bg-[#161b22] overflow-hidden">
                          <button
                            onClick={() => toggleTool(call.id)}
                            className="w-full flex items-center justify-between p-2 text-xs bg-[#21262d]/50 hover:bg-[#21262d] transition-colors text-left"
                          >
                            <div className="flex items-center space-x-2 truncate pr-2">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="text-[#a371f7] font-semibold">{call.name}</span>
                              <span className="text-[#8b949e] truncate font-mono text-[11px]">
                                {JSON.stringify(call.args)}
                              </span>
                            </div>
                            <div>
                              {result ? (
                                result.isError ? (
                                  <span className="text-red-400 flex items-center gap-1"><XCircle size={12} /> Failed</span>
                                ) : (
                                  <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Executed</span>
                                )
                              ) : (
                                <span className="text-amber-400 flex items-center gap-1"><Clock size={12} /> Running</span>
                              )}
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="p-3 bg-[#0d1117] border-t border-[#30363d] font-mono text-[11px] max-h-60 overflow-y-auto whitespace-pre-wrap">
                              {result ? result.output : 'Executing tool action...'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pending Approval Dialog */}
                {msg.pendingApproval && (
                  <div className="border-2 border-amber-500/50 bg-amber-950/20 rounded-lg p-3 my-2 space-y-2">
                    <div className="flex items-center space-x-2 text-amber-400 font-semibold">
                      <AlertTriangle size={16} />
                      <span>Risky Action Approval Required</span>
                    </div>
                    <p className="text-xs text-[#c9d1d9]">{msg.pendingApproval.description}</p>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => onResolveApproval(msg.id, 'approve')}
                        className="px-3 py-1 text-xs rounded bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
                      >
                        Approve [y]
                      </button>
                      <button
                        onClick={() => onResolveApproval(msg.id, 'always')}
                        className="px-3 py-1 text-xs rounded bg-[#21262d] hover:bg-[#30363d] text-amber-300 border border-[#30363d] transition-colors"
                      >
                        Always Approve for Session [a]
                      </button>
                      <button
                        onClick={() => onResolveApproval(msg.id, 'reject')}
                        className="px-3 py-1 text-xs rounded bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800 transition-colors"
                      >
                        Reject [n]
                      </button>
                    </div>
                  </div>
                )}

                {/* Assistant Content text */}
                {msg.content && (
                  <div className="text-[#c9d1d9] whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </div>
                )}

                {/* Quick Action Suggestion Chips for Update / Discard queries */}
                {(msg.content.includes('/update apply') || msg.content.includes('git restore') || msg.content.includes('local changes')) && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[#30363d]/40">
                    <button
                      onClick={() => onSendMessage('/discard')}
                      className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/40 text-xs flex items-center space-x-1"
                    >
                      <span>🧹 Discard Changes (/discard)</span>
                    </button>
                    <button
                      onClick={() => onSendMessage('/update apply')}
                      className="px-2.5 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/40 text-xs flex items-center space-x-1"
                    >
                      <span>🚀 Fast-Forward (/update apply)</span>
                    </button>
                    {onOpenGitPanel && (
                      <button
                        onClick={onOpenGitPanel}
                        className="px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] text-xs flex items-center space-x-1"
                      >
                        <span>⚡ Open Git Manager</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Files Touched Summary Banner */}
                {msg.touchedFiles && msg.touchedFiles.length > 0 && (
                  <div className="bg-[#161b22] border border-[#30363d] rounded p-2.5 mt-2 flex items-start space-x-2 text-xs">
                    <FileText size={14} className="text-[#58a6ff] mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-[#58a6ff]">Files touched this turn:</span>
                      <ul className="list-disc list-inside mt-1 space-y-0.5 text-[#8b949e]">
                        {msg.touchedFiles.map(file => (
                          <li key={file} className="text-[#c9d1d9]">{file}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-center space-x-2 text-[#58a6ff] animate-pulse py-2 pl-2">
            <span className="font-bold">Miss Data ›</span>
            <span className="text-xs">processing command...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Slash Command Autocomplete Popup */}
      {autocompleteOpen && matchingCommands.length > 0 && (
        <div className="mx-3 mb-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
          <div className="p-1.5 bg-[#21262d] border-b border-[#30363d] text-[10px] text-[#8b949e] flex justify-between">
            <span>Slash Commands (Tab or Enter to choose)</span>
            <span>{matchingCommands.length} matches</span>
          </div>
          {matchingCommands.map((c, i) => (
            <div
              key={c.cmd}
              onClick={() => {
                setInput(c.cmd);
                setAutocompleteOpen(false);
                inputRef.current?.focus();
              }}
              onMouseEnter={() => setAutocompleteIndex(i)}
              className={`px-3 py-1.5 flex items-center justify-between cursor-pointer text-xs ${
                i === autocompleteIndex ? 'bg-[#21262d] text-white' : 'text-[#c9d1d9] hover:bg-[#1f242c]'
              }`}
            >
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-[#58a6ff]">{c.cmd}</span>
                <span className="text-[11px] text-[#8b949e]">{c.desc}</span>
              </div>
              <span className="text-[10px] px-1 rounded bg-[#0d1117] text-[#8b949e]">{c.cat}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input Prompt Bar */}
      <div className="border-t border-[#30363d] p-3 bg-[#161b22]">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <span className="text-emerald-400 font-bold select-none text-sm">You ›</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a request or slash command (/update, /discard, /doctor, /status, /man)..."
            disabled={loading}
            className="flex-1 bg-transparent border-none outline-none text-[#f0f6fc] placeholder-[#8b949e] font-mono text-sm"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white transition-colors"
          >
            <Send size={14} />
          </button>
        </form>

        <div className="flex justify-between items-center text-[11px] text-[#8b949e] mt-2 px-1">
          <div className="flex items-center space-x-3">
            <span>↑↓ for history</span>
            <span>•</span>
            <span>Tab for autocomplete</span>
            <span>•</span>
            <span>Ctrl+K for palette</span>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={onClear}
              className="hover:text-[#c9d1d9] transition-colors"
            >
              Clear screen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
