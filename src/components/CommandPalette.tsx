import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Terminal, 
  Cpu, 
  GitBranch, 
  Trash2, 
  ShieldCheck, 
  Bookmark, 
  BookOpen, 
  Activity, 
  Layers, 
  Settings, 
  Zap, 
  X,
  Languages,
  Code
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCommand: (cmd: string) => void;
}

interface CommandItem {
  id: string;
  name: string;
  category: 'System' | 'Git & Updates' | 'Workflows' | 'Config' | 'Memory';
  description: string;
  command: string;
  icon: any;
  shortcut?: string;
}

export function CommandPalette({ isOpen, onClose, onSelectCommand }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: CommandItem[] = [
    // Git & Updates
    {
      id: 'update-check',
      name: '/update check',
      category: 'Git & Updates',
      description: 'Check official repository (RootedMani/Miss-Data) for updates',
      command: '/update check',
      icon: GitBranch,
    },
    {
      id: 'update-apply',
      name: '/update apply',
      category: 'Git & Updates',
      description: 'Fast-forward checkout from trusted upstream repository',
      command: '/update apply',
      icon: Zap,
    },
    {
      id: 'discard',
      name: '/discard',
      category: 'Git & Updates',
      description: 'Discard all local working tree modifications and untracked files',
      command: '/discard',
      icon: Trash2,
      shortcut: 'git restore .',
    },
    {
      id: 'diff',
      name: '/diff',
      category: 'Git & Updates',
      description: 'Inspect bounded diff of modified project files',
      command: '/diff',
      icon: Code,
    },
    {
      id: 'checkpoints',
      name: '/checkpoints',
      category: 'Git & Updates',
      description: 'List recent checkpoints or rollback points',
      command: '/checkpoints',
      icon: Bookmark,
    },

    // System
    {
      id: 'status',
      name: '/status',
      category: 'System',
      description: 'Display active model, budget, safeguards, and memory status',
      command: '/status',
      icon: Terminal,
    },
    {
      id: 'doctor',
      name: '/doctor',
      category: 'System',
      description: 'Run zero-token health diagnostics on repository & providers',
      command: '/doctor',
      icon: Activity,
    },
    {
      id: 'clear',
      name: '/clear',
      category: 'System',
      description: 'Clear current conversation messages (preserves memory facts)',
      command: '/clear',
      icon: Trash2,
    },
    {
      id: 'compact',
      name: '/compact',
      category: 'System',
      description: 'Compact older conversation history into summary context note',
      command: '/compact',
      icon: Layers,
    },

    // Workflows
    {
      id: 'map',
      name: '/map',
      category: 'Workflows',
      description: 'Analyze project structure, dependencies, and test commands',
      command: '/map',
      icon: BookOpen,
    },
    {
      id: 'test',
      name: '/test',
      category: 'Workflows',
      description: 'Discover test commands and inspect execution suggestions',
      command: '/test',
      icon: Zap,
    },
    {
      id: 'mode-plan',
      name: '/mode plan',
      category: 'Workflows',
      description: 'Require plan review before any tools can make modifications',
      command: '/mode plan',
      icon: ShieldCheck,
    },
    {
      id: 'mode-direct',
      name: '/mode direct',
      category: 'Workflows',
      description: 'Allow tools to act directly without mandatory prior plan step',
      command: '/mode direct',
      icon: Zap,
    },

    // Memory
    {
      id: 'memory',
      name: '/memory',
      category: 'Memory',
      description: 'View list of durable facts remembered across sessions',
      command: '/memory',
      icon: Bookmark,
    },

    // Config & Language
    {
      id: 'lang-en',
      name: '/lang en',
      category: 'Config',
      description: 'Switch assistant responses to English',
      command: '/lang en',
      icon: Languages,
    },
    {
      id: 'lang-fa',
      name: '/lang fa',
      category: 'Config',
      description: 'Switch assistant responses to Persian (فارسی)',
      command: '/lang fa',
      icon: Languages,
    },
    {
      id: 'sandbox-on',
      name: '/sandbox on',
      category: 'Config',
      description: 'Confine file modifications strictly to working directory',
      command: '/sandbox on',
      icon: ShieldCheck,
    },
    {
      id: 'sandbox-off',
      name: '/sandbox off',
      category: 'Config',
      description: 'Disable directory boundary confinement',
      command: '/sandbox off',
      icon: ShieldCheck,
    },
    {
      id: 'budget-economy',
      name: '/budget economy',
      category: 'Config',
      description: 'Set low output token cap (768 tokens) to save budget',
      command: '/budget economy',
      icon: Cpu,
    },
    {
      id: 'budget-thorough',
      name: '/budget thorough',
      category: 'Config',
      description: 'Set high output token cap (4096 tokens) for in-depth tasks',
      command: '/budget thorough',
      icon: Cpu,
    },
  ];

  const filtered = commands.filter(c => 
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase()) ||
    c.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelectCommand(filtered[selectedIndex].command);
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden font-mono text-xs flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="p-3 border-b border-[#30363d] flex items-center space-x-2.5 bg-[#0d1117]">
          <Search size={16} className="text-[#8b949e]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a slash command or search actions..."
            className="flex-1 bg-transparent text-sm text-[#f0f6fc] placeholder-[#8b949e] focus:outline-none"
          />
          <div className="flex items-center space-x-1 text-[10px] text-[#8b949e] px-1.5 py-0.5 rounded bg-[#21262d] border border-[#30363d]">
            <span>ESC to close</span>
          </div>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-[#8b949e]">
              No matching commands found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectCommand(item.command);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#21262d] text-[#f0f6fc]' : 'text-[#c9d1d9] hover:bg-[#1f242c]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div className={`p-1.5 rounded ${isSelected ? 'bg-[#30363d] text-[#58a6ff]' : 'bg-[#0d1117] text-[#8b949e]'}`}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-xs text-[#58a6ff]">{item.name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0d1117] text-[#8b949e] border border-[#30363d]/50">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8b949e] truncate mt-0.5">{item.description}</p>
                    </div>
                  </div>

                  {item.shortcut && (
                    <span className="text-[10px] text-[#8b949e] font-mono shrink-0 ml-2">
                      {item.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div className="p-2 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between text-[10px] text-[#8b949e] px-3">
          <div className="flex items-center space-x-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
          </div>
          <span>Miss Data Command Palette</span>
        </div>
      </div>
    </div>
  );
}
