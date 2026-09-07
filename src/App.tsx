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
  AlertCircle
} from 'lucide-react';
import { Terminal } from './components/Terminal';
import { WorkspaceExplorer } from './components/WorkspaceExplorer';
import { WorkflowsPanel } from './components/WorkflowsPanel';
import { ManualModal } from './components/ManualModal';
import { SettingsModal } from './components/SettingsModal';
import { SessionsDrawer } from './components/SessionsDrawer';
import { Message, AgentStatus } from './types';

export function App() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'workspace' | 'workflows'>('terminal');
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [sessionsOpen, setSessionsOpen] = useState<boolean>(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchStatus();
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

  const handleClear = () => {
    handleSendMessage('/clear');
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0e1117] text-[#e6edf3] font-mono overflow-hidden">
      {/* Top Navbar */}
      <header className="h-14 border-b border-[#30363d] bg-[#161b22] px-4 flex items-center justify-between shrink-0">
        {/* Left: Brand & Status Indicators */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <TerminalIcon size={14} />
            </div>
            <div className="flex items-baseline space-x-1.5">
              <span className="font-bold text-sm tracking-wide text-[#f0f6fc]">Miss Data</span>
              <span className="text-xs text-[#8b949e] hidden sm:inline">(خانم داده)</span>
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
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-sm'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            <TerminalIcon size={13} />
            <span>Terminal</span>
          </button>
          <button
            onClick={() => setActiveTab('workspace')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
              activeTab === 'workspace'
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-sm'
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
                ? 'bg-[#21262d] text-[#f0f6fc] shadow-sm'
                : 'text-[#8b949e] hover:text-[#c9d1d9]'
            }`}
          >
            <Workflow size={13} />
            <span>Workflows</span>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setManualOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-xs transition-colors"
            title="Open In-Program Manual (/man)"
          >
            <BookOpen size={13} className="text-[#58a6ff]" />
            <span className="hidden sm:inline">Manual</span>
          </button>

          <button
            onClick={() => setSessionsOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-xs transition-colors"
            title="Manage Saved Sessions"
          >
            <Layers size={13} className="text-[#a371f7]" />
            <span className="hidden sm:inline">Sessions</span>
          </button>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] transition-colors"
            title="Miss Data Configuration"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'terminal' && (
          <Terminal
            messages={messages}
            status={status}
            loading={loading}
            onSendMessage={handleSendMessage}
            onResolveApproval={handleResolveApproval}
            onClear={handleClear}
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

      {/* Modals & Drawers */}
      <ManualModal
        isOpen={manualOpen}
        onClose={() => setManualOpen(false)}
        onRunExample={(cmd) => {
          setActiveTab('terminal');
          handleSendMessage(cmd);
        }}
      />

      <SettingsModal
        isOpen={settingsOpen}
        status={status}
        onClose={() => setSettingsOpen(false)}
        onUpdateSettings={handleUpdateSettings}
      />

      <SessionsDrawer
        isOpen={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onSessionSwitched={fetchStatus}
      />
    </div>
  );
}
