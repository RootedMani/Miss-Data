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
  Play
} from 'lucide-react';
import { Message, AgentStatus, ToolCall, ToolResult } from '../types';

interface TerminalProps {
  messages: Message[];
  status: AgentStatus | null;
  loading: boolean;
  onSendMessage: (text: string) => void;
  onResolveApproval: (messageId: string, action: 'approve' | 'always' | 'reject') => void;
  onClear: () => void;
}

export const Terminal: React.FC<TerminalProps> = ({
  messages,
  status,
  loading,
  onSendMessage,
  onResolveApproval,
  onClear,
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    }
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleTool = (id: string) => {
    setExpandedTools(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] font-mono text-sm">
      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Welcome Header */}
        <div className="border border-[#30363d] bg-[#161b22] rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between border-b border-[#30363d] pb-2 mb-3">
            <div className="flex items-center space-x-2">
              <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-bold text-emerald-400">Miss Data (خانم داده)</span>
              <span className="text-xs text-[#8b949e]">v1.0.0</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
              Terminal Coding Agent
            </span>
          </div>

          <p className="text-xs text-[#8b949e] mb-2 leading-relaxed">
            A terminal coding assistant. Reads & edits files, inspects codebases, runs commands in a safe sandbox, and remembers durable facts across sessions.
          </p>

          <div className="flex flex-wrap gap-2 text-xs">
            <button 
              onClick={() => onSendMessage('/status')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
            >
              /status
            </button>
            <button 
              onClick={() => onSendMessage('/map')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
            >
              /map
            </button>
            <button 
              onClick={() => onSendMessage('/doctor')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
            >
              /doctor
            </button>
            <button 
              onClick={() => onSendMessage('/man getting-started')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
            >
              /man getting-started
            </button>
            <button 
              onClick={() => onSendMessage('/update')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#7ee787] border border-[#30363d] transition-colors"
            >
              /update
            </button>
            <button 
              onClick={() => onSendMessage('/discard')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#f0883e] border border-[#30363d] transition-colors"
            >
              /discard
            </button>
            <button 
              onClick={() => onSendMessage('Find any TODO comments in this project')}
              className="px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] transition-colors"
            >
              Scan TODOs
            </button>
          </div>
        </div>

        {/* Message Log */}
        {messages.map((msg) => (
          <div key={msg.id} className="space-y-2">
            {msg.role === 'user' ? (
              <div className="flex items-start space-x-2">
                <span className="text-emerald-400 font-bold select-none">You ›</span>
                <span className="text-[#f0f6fc] font-medium whitespace-pre-wrap flex-1">{msg.content}</span>
              </div>
            ) : msg.role === 'system' ? (
              <div className="bg-[#161b22] border-l-2 border-[#8b949e] px-3 py-1.5 text-xs text-[#8b949e]">
                {msg.content}
              </div>
            ) : (
              <div className="space-y-2">
                {/* Agent Header Marker */}
                <div className="flex items-center justify-between">
                  <span className="text-[#58a6ff] font-bold select-none">Miss Data ›</span>
                  <button
                    onClick={() => copyText(msg.content, msg.id)}
                    className="text-xs text-[#8b949e] hover:text-[#c9d1d9] flex items-center space-x-1"
                    title="Copy response"
                  >
                    {copiedId === msg.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                {/* Tool Calls Execution Box */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-2 my-2">
                    {msg.toolCalls.map((call) => {
                      const result = msg.toolResults?.find(r => r.toolCallId === call.id);
                      const isExpanded = expandedTools[call.id] ?? false;

                      return (
                        <div key={call.id} className="border border-[#30363d] bg-[#161b22] rounded-md overflow-hidden text-xs">
                          <button
                            onClick={() => toggleTool(call.id)}
                            className="w-full flex items-center justify-between px-3 py-2 bg-[#21262d] hover:bg-[#2b313a] text-left"
                          >
                            <div className="flex items-center space-x-2">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="text-[#f0883e] font-semibold">tool:{call.name}</span>
                              <span className="text-[#8b949e] truncate max-w-xs sm:max-w-md">
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
          <div className="flex items-center space-x-2 text-[#58a6ff] animate-pulse py-2">
            <span className="font-bold">Miss Data ›</span>
            <span className="text-xs">thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Prompt Bar */}
      <div className="border-t border-[#30363d] p-3 bg-[#161b22]">
        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <span className="text-emerald-400 font-bold select-none text-sm">You ›</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a request or slash command (/help, /status, /map, /man)..."
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
            <span>Tab for /commands</span>
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
