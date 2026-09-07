import React, { useState, useEffect } from 'react';
import { Layers, Plus, X, MessageSquare, Trash2, Edit2, Check } from 'lucide-react';
import { SessionItem } from '../types';

interface SessionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionSwitched: () => void;
}

export const SessionsDrawer: React.FC<SessionsDrawerProps> = ({
  isOpen,
  onClose,
  onSessionSwitched,
}) => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentId, setCurrentId] = useState<string>('');
  const [newTitle, setNewTitle] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>('');

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;
      const data = await res.json();
      if (data.sessions) {
        setSessions(data.sessions);
        setCurrentId(data.currentId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const handleCreateSession = async () => {
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'new', title: newTitle || undefined }),
      });
      setNewTitle('');
      await fetchSessions();
      onSessionSwitched();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSwitchSession = async (id: string) => {
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', id }),
      });
      await fetchSessions();
      onSessionSwitched();
      onClose();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRename = async (id: string) => {
    if (!renameText.trim()) return;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', id, title: renameText.trim() }),
      });
      setEditingId(null);
      await fetchSessions();
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm font-mono">
      <div className="bg-[#161b22] border-l border-[#30363d] w-full max-w-md h-full flex flex-col shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center space-x-2">
            <Layers size={18} className="text-[#58a6ff]" />
            <h2 className="text-sm font-bold text-[#f0f6fc]">Saved Sessions (/sessions)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]"
          >
            <X size={18} />
          </button>
        </div>

        {/* New Session Action */}
        <div className="p-3 border-b border-[#30363d] bg-[#161b22]">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="New session title..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-[#0d1117] border border-[#30363d] rounded text-xs text-[#f0f6fc] outline-none placeholder-[#8b949e]"
            />
            <button
              onClick={handleCreateSession}
              className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold transition-colors"
            >
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`p-3 rounded-lg border text-xs transition-colors flex items-start justify-between ${
                currentId === session.id
                  ? 'bg-[#21262d] border-[#58a6ff]'
                  : 'bg-[#0d1117] border-[#30363d] hover:border-[#8b949e]'
              }`}
            >
              <div 
                className="flex-1 cursor-pointer pr-2"
                onClick={() => handleSwitchSession(session.id)}
              >
                {editingId === session.id ? (
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      className="px-2 py-0.5 bg-[#161b22] border border-[#58a6ff] rounded text-xs text-white outline-none"
                    />
                    <button onClick={() => handleRename(session.id)} className="text-emerald-400 p-1">
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="font-semibold text-[#f0f6fc] flex items-center gap-2">
                    <MessageSquare size={13} className={currentId === session.id ? 'text-[#58a6ff]' : 'text-[#8b949e]'} />
                    <span>{session.title}</span>
                    {currentId === session.id && (
                      <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.2 rounded">
                        Active
                      </span>
                    )}
                  </div>
                )}
                <div className="text-[11px] text-[#8b949e] mt-1 flex items-center space-x-3">
                  <span>{session.messageCount} messages</span>
                  <span>•</span>
                  <span>{new Date(session.updatedAt).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => {
                    setEditingId(session.id);
                    setRenameText(session.title);
                  }}
                  className="p-1 hover:bg-[#21262d] rounded text-[#8b949e] hover:text-[#c9d1d9]"
                  title="Rename"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
