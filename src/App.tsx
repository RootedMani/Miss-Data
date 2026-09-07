import React, { useState, useEffect } from 'react';
import { 
  Terminal as TerminalIcon, 
  FolderTree, 
  Workflow, 
  BookOpen, 
  Settings as SettingsIcon, 
  Layers, 
  ShieldCheck, 
  Cpu, 
  Zap, 
  Sliders, 
  Globe,
  AlertCircle,
  GitBranch,
  Brain,
  Search,
  Languages
} from 'lucide-react';
import { Terminal } from './components/Terminal';
import { WorkspaceExplorer } from './components/WorkspaceExplorer';
import { WorkflowsPanel } from './components/WorkflowsPanel';
import { GitPanel } from './components/GitPanel';
import { ShellDrawer } from './components/ShellDrawer';
import { MemoryModal } from './components/MemoryModal';
import { CommandPalette } from './components/CommandPalette';
import { ManualModal } from './components/ManualModal';
import { SettingsModal } from './components/SettingsModal';
import { SessionsDrawer } from './components/SessionsDrawer';
import { Message, AgentStatus, GitStatus } from './types';

export function App() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'git' | 'workspace' | 'workflows'>('terminal');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Modals & Drawers
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [sessionsOpen, setSessionsOpen] = useState<boolean>(false);
  const [shellOpen, setShellOpen] = useState<boolean>(false);
  const [memoryOpen, setMemoryOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('Error fetching status:', e);
    }
  };

  const fetchGitStatus = async () => {
    try {
      const res = await fetch('/api/git/status');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;
      const data = await res.json();
      setGitStatus(data);
    } catch (e) {
      console.error('Error fetching git status:', e);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchGitStatus();

    // Global keyboard shortcuts (Cmd+K / Ctrl+K for command palette)
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        setShellOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const handleSendMessage = async (text: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
      if (data.status) {
        setStatus(data.status);
      }
      fetchGitStatus();
    } catch (e) {
      console.error(e);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `Connection error: Could not reach Miss Data server.`,
          timestamp: Date.now(),
          status: 'error',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleResolveApproval = async (messageId: string, action: 'approve' | 'always' | 'reject') => {
    setLoading(true);
    try {
      const res = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, action }),
      });
      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
      if (data.status) {
        setStatus(data.status);
      }
      fetchGitStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<AgentStatus>) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleLanguage = () => {
    const next = status?.responseLanguage === 'fa' ? 'en' : 'fa';
    handleUpdateSettings({ responseLanguage: next });
    handleSendMessage(`/lang ${next}`);
  };

  const handleClear = () => {
    handleSendMessage('/clear');
  };

  const gitHasIssue = gitStatus && (!gitStatus.isClean || gitStatus.diverged);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0e1117] text-[#e6edf3] font-mono overflow-hidden select-none">
      {/* Top Navbar */}
      <header className="h-14 border-b border-[#30363d] bg-[#161b22] px-3 sm:px-4 flex items-center justify-between shrink-0">
        {/* Left: Brand & Status Indicators */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <TerminalIcon size={15} />
            </div>
            <div className="flex items-baseline space-x-1.5">
              <span className="font-bold text-sm tracking-wide text-[#f0f6fc]">Miss Data</span>
              <span className="text-xs text-[#8b949e] hidden md:inline">(خانم داده)</span>
            </div>
          </div>

          <div className="h-4 w-px bg-[#30363d] hidden sm:block" />

          {/* Quick Status Badges */}
          {status && (
            <div className="hidden lg:flex items-center space-x-2 text-[11px]">
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#58a6ff]">
                <Cpu size={12} />
                <span>{status.provider}:{status.model}</span>
              </div>
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-[#7ee787]">
                <ShieldCheck size={12} />
                <span>Sandbox: {status.sandboxMode ? 'ON' : 'OFF'}</span>
              </div>
              <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#0d1117] border border-[#30363d] text-amber-400">
                <Sliders size={12} />
                <span className="capitalize">{status.approvalMode}</span>
              </div>
            </div>
          )}
        </div>

        {/* Center: Main View Navigation Tabs */}
        <div className="flex items-center space-x-1 bg-[#0d1117] p-1 rounded-lg border border-[#30363d]">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'terminal'
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            <TerminalIcon size={13} />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => { setActiveTab('git'); fetchGitStatus(); }}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors relative ${
              activeTab === 'git'
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            <GitBranch size={13} className={gitHasIssue ? 'text-amber-400' : ''} />
            <span>Git & Sync</span>
            {gitHasIssue && (
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping absolute -top-0.5 -right-0.5" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('workspace')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'workspace'
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            <FolderTree size={13} />
            <span>Files</span>
          </button>

          <button
            onClick={() => setActiveTab('workflows')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'workflows'
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-xs'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            <Workflow size={13} />
            <span>Workflows</span>
          </button>
        </div>

        {/* Right: Actions & Tools */}
        <div className="flex items-center space-x-1.5 sm:space-x-2">
          {/* Command Palette Trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] border border-[#30363d] text-xs transition-colors"
            title="Command Palette (Ctrl+K)"
          >
            <Search size={13} />
            <span className="hidden sm:inline">Commands</span>
            <kbd className="hidden md:inline px-1 py-0.2 rounded bg-[#161b22] text-[10px] text-[#8b949e] border border-[#30363d]">
              ⌘K
            </kbd>
          </button>

          {/* Direct Shell Drawer Trigger */}
          <button
            onClick={() => setShellOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#7ee787] border border-[#30363d] text-xs transition-colors"
            title="Direct Sandbox Shell Runner (Ctrl+`)"
          >
            <span className="font-bold">$</span>
            <span className="hidden sm:inline">Shell</span>
          </button>

          {/* Memory Vault Trigger */}
          <button
            onClick={() => setMemoryOpen(true)}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] text-xs transition-colors"
            title="Durable Memory Vault"
          >
            <Brain size={13} />
            <span className="hidden sm:inline">Memory</span>
            {status && status.memoryCount > 0 && (
              <span className="px-1 py-0.2 rounded bg-[#a371f7]/20 text-[10px] font-bold text-[#a371f7]">
                {status.memoryCount}
              </span>
            )}
          </button>

          {/* Language Switcher */}
          <button
            onClick={toggleLanguage}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-xs transition-colors"
            title="Toggle Response Language (English / Persian)"
          >
            <Languages size={13} className="text-emerald-400" />
            <span className="hidden sm:inline">{status?.responseLanguage === 'fa' ? 'فارسی' : 'EN'}</span>
          </button>

          {/* Manual Modal Trigger */}
          <button
            onClick={() => setManualOpen(true)}
            className="p-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] border border-[#30363d] transition-colors"
            title="In-Program Manual (/man)"
          >
            <BookOpen size={14} />
          </button>

          {/* Sessions Drawer Trigger */}
          <button
            onClick={() => setSessionsOpen(true)}
            className="p-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] transition-colors"
            title="Saved Sessions"
          >
            <Layers size={14} />
          </button>

          {/* Settings Modal Trigger */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] transition-colors"
            title="Settings & Provider Config"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'terminal' && (
          <Terminal
            messages={messages}
            status={status}
            loading={loading}
            onSendMessage={handleSendMessage}
            onResolveApproval={handleResolveApproval}
            onClear={handleClear}
            onOpenGitPanel={() => setActiveTab('git')}
            onOpenShell={() => setShellOpen(true)}
          />
        )}

        {activeTab === 'git' && (
          <GitPanel
            onRunTerminalCommand={(cmd) => {
              setActiveTab('terminal');
              handleSendMessage(cmd);
            }}
          />
        )}

        {activeTab === 'workspace' && (
          <WorkspaceExplorer
            onAskAgent={(prompt) => {
              setActiveTab('terminal');
              handleSendMessage(prompt);
            }}
          />
        )}

        {activeTab === 'workflows' && (
          <WorkflowsPanel
            onRunCommand={(cmd) => {
              setActiveTab('terminal');
              handleSendMessage(cmd);
            }}
          />
        )}
      </main>

      {/* Direct Sandbox Shell Drawer */}
      <ShellDrawer
        isOpen={shellOpen}
        onClose={() => setShellOpen(false)}
        onSendToAgent={(cmd) => {
          setShellOpen(false);
          setActiveTab('terminal');
          handleSendMessage(cmd);
        }}
      />

      {/* Durable Memory Vault Modal */}
      <MemoryModal
        isOpen={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        onMemoryChanged={fetchStatus}
      />

      {/* Interactive Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectCommand={(cmd) => {
          setActiveTab('terminal');
          handleSendMessage(cmd);
        }}
      />

      {/* Manual Documentation Modal */}
      <ManualModal
        isOpen={manualOpen}
        onClose={() => setManualOpen(false)}
        onRunExample={(cmd) => {
          setActiveTab('terminal');
          handleSendMessage(cmd);
        }}
      />

      {/* Configuration Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        status={status}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={handleUpdateSettings}
      />

      {/* Sessions Drawer */}
      <SessionsDrawer
        isOpen={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onSessionSwitched={fetchStatus}
      />
    </div>
  );
}
