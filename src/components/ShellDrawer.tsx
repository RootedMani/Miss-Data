import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, Play, Trash2, X, Copy, Check, CornerDownLeft, Sparkles } from 'lucide-react';
import { DirectCommandResult } from '../types';

interface ShellDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSendToAgent?: (cmd: string) => void;
}

export function ShellDrawer({ isOpen, onClose, onSendToAgent }: ShellDrawerProps) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<DirectCommandResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const outputBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const presets = [
    { label: 'git status', cmd: 'git status' },
    { label: 'git log (recent)', cmd: 'git log --oneline -n 6' },
    { label: 'git diff --stat', cmd: 'git diff --stat' },
    { label: 'list files', cmd: 'ls -la' },
    { label: 'git remote', cmd: 'git remote -v' },
    { label: 'check branch', cmd: 'git branch -v' },
  ];

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    outputBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  if (!isOpen) return null;

  const handleExecute = async (cmdToRun?: string) => {
    const target = (cmdToRun || command).trim();
    if (!target) return;

    setLoading(true);
    setCommand('');
    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: target }),
      });
      const data = await res.json();
      const result: DirectCommandResult = {
        command: target,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? (data.stderr ? 1 : 0),
        timestamp: Date.now(),
      };
      setHistory(prev => [...prev, result]);
    } catch (e: any) {
      setHistory(prev => [
        ...prev,
        {
          command: target,
          stdout: '',
          stderr: `Execution error: ${e.message}`,
          exitCode: 1,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const copyOutput = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-2xl h-full bg-[#0d1117] border-l border-[#30363d] flex flex-col shadow-2xl font-mono text-xs text-[#e6edf3]">
        {/* Drawer Header */}
        <div className="h-12 px-4 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <TerminalIcon size={16} className="text-[#7ee787]" />
            <span className="font-semibold text-sm text-[#f0f6fc]">Direct Sandbox Shell</span>
            <span className="text-[11px] px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
              safe execution
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setHistory([])}
              className="p-1 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
              title="Clear output"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Preset Shell Commands Bar */}
        <div className="p-2.5 bg-[#161b22]/50 border-b border-[#30363d] flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-[#8b949e] mr-1 flex items-center space-x-1">
            <Sparkles size={11} className="text-[#a371f7]" />
            <span>Presets:</span>
          </span>
          {presets.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleExecute(p.cmd)}
              disabled={loading}
              className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] hover:text-[#79c0ff] border border-[#30363d] text-[11px] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Output Console History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#090d13]">
          {history.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#8b949e] space-y-2 select-none opacity-60">
              <TerminalIcon size={32} />
              <p>Direct sandbox shell runner ready.</p>
              <p className="text-[11px]">Type any shell command below or click a preset above.</p>
            </div>
          ) : (
            history.map((item, idx) => (
              <div key={idx} className="rounded-lg bg-[#161b22] border border-[#30363d] overflow-hidden">
                <div className="px-3 py-1.5 bg-[#21262d]/70 border-b border-[#30363d] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[#7ee787]">$</span>
                    <span className="font-semibold text-[#f0f6fc]">{item.command}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                        item.exitCode === 0
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                          : 'bg-rose-950 text-rose-400 border border-rose-800/40'
                      }`}
                    >
                      exit: {item.exitCode}
                    </span>
                    <button
                      onClick={() => copyOutput(item.stdout || item.stderr, idx)}
                      className="p-1 rounded text-[#8b949e] hover:text-[#c9d1d9]"
                      title="Copy output"
                    >
                      {copiedIdx === idx ? <Check size={12} className="text-[#7ee787]" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                <div className="p-3">
                  {item.stdout && (
                    <pre className="text-xs text-[#c9d1d9] whitespace-pre-wrap leading-relaxed overflow-x-auto">
                      {item.stdout}
                    </pre>
                  )}
                  {item.stderr && (
                    <pre className="text-xs text-rose-400 whitespace-pre-wrap leading-relaxed overflow-x-auto mt-1">
                      {item.stderr}
                    </pre>
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center space-x-2 text-[#8b949e] italic text-xs animate-pulse p-2">
              <span className="w-2 h-2 rounded-full bg-[#7ee787] animate-ping" />
              <span>Running command...</span>
            </div>
          )}
          <div ref={outputBottomRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-[#30363d] bg-[#161b22]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleExecute();
            }}
            className="flex items-center space-x-2"
          >
            <div className="flex-1 flex items-center bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 focus-within:border-[#58a6ff]">
              <span className="text-[#7ee787] mr-2 font-bold">$</span>
              <input
                ref={inputRef}
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Type command (e.g. git status, ls -la)..."
                disabled={loading}
                className="flex-1 bg-transparent text-xs text-[#f0f6fc] placeholder-[#8b949e] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !command.trim()}
              className="px-3 py-1.5 rounded-md bg-[#238636] hover:bg-[#2ea043] text-white text-xs font-semibold flex items-center space-x-1 disabled:opacity-50 transition-colors"
            >
              <Play size={12} />
              <span>Run</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
