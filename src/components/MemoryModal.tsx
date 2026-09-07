import React, { useState, useEffect } from 'react';
import { Brain, Plus, Trash2, X, Search, Sparkles, AlertCircle } from 'lucide-react';
import { MemoryFact } from '../types';

interface MemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMemoryChanged?: () => void;
}

export function MemoryModal({ isOpen, onClose, onMemoryChanged }: MemoryModalProps) {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [newFact, setNewFact] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchMemory = async () => {
    try {
      const res = await fetch('/api/memory');
      const data = await res.json();
      setFacts(data.facts || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMemory();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFact.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/memory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact: newFact.trim() }),
      });
      const data = await res.json();
      setFacts(data.facts || []);
      setNewFact('');
      onMemoryChanged?.();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFact = async (id: number) => {
    try {
      const res = await fetch(`/api/memory/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      setFacts(data.facts || []);
      onMemoryChanged?.();
    } catch (e) {
      console.error(e);
    }
  };

  const filteredFacts = facts.filter(f => f.fact.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] font-mono text-xs text-[#e6edf3]">
        {/* Header */}
        <div className="h-14 px-4 border-b border-[#30363d] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Brain size={18} className="text-[#a371f7]" />
            <div>
              <span className="font-bold text-sm text-[#f0f6fc]">Durable Memory Vault</span>
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">
                {facts.length} fact{facts.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search & Description */}
        <div className="p-3 bg-[#0d1117] border-b border-[#30363d] space-y-2">
          <p className="text-[11px] text-[#8b949e] leading-relaxed">
            Facts saved here persist across resets, compacting, and sessions. Miss Data references them in every conversation turn.
          </p>
          <div className="flex items-center bg-[#161b22] border border-[#30363d] rounded-md px-2.5 py-1.5">
            <Search size={13} className="text-[#8b949e] mr-2" />
            <input
              type="text"
              placeholder="Search remembered facts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-[#c9d1d9] placeholder-[#8b949e] focus:outline-none"
            />
          </div>
        </div>

        {/* Fact List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filteredFacts.length === 0 ? (
            <div className="text-center py-8 text-[#8b949e] space-y-1">
              <Brain size={24} className="mx-auto opacity-40 mb-2" />
              <p>No remembered facts found.</p>
              <p className="text-[11px]">Add a fact below or tell Miss Data: "Remember that..."</p>
            </div>
          ) : (
            filteredFacts.map((f) => (
              <div
                key={f.id}
                className="flex items-start justify-between p-2.5 rounded-lg bg-[#0d1117] border border-[#30363d] hover:border-[#58a6ff]/50 transition-colors group"
              >
                <div className="flex items-start space-x-2.5 pr-2">
                  <span className="text-[10px] font-bold text-[#a371f7] bg-[#a371f7]/10 px-1.5 py-0.5 rounded mt-0.5">
                    #{f.id}
                  </span>
                  <span className="text-xs text-[#c9d1d9] leading-relaxed break-words">{f.fact}</span>
                </div>
                <button
                  onClick={() => handleDeleteFact(f.id)}
                  className="p-1 rounded text-[#8b949e] hover:text-rose-400 opacity-60 group-hover:opacity-100 transition-opacity"
                  title="Forget this fact"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add Fact Footer */}
        <form onSubmit={handleAddFact} className="p-3 border-t border-[#30363d] bg-[#161b22] flex space-x-2">
          <input
            type="text"
            placeholder="Add new persistent memory fact..."
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            disabled={loading}
            className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-1.5 text-xs text-[#c9d1d9] focus:outline-none focus:border-[#a371f7]"
          />
          <button
            type="submit"
            disabled={loading || !newFact.trim()}
            className="px-3 py-1.5 rounded-md bg-[#a371f7] hover:bg-[#8a57e3] text-black font-semibold text-xs flex items-center space-x-1 disabled:opacity-50 transition-colors"
          >
            <Plus size={13} />
            <span>Add</span>
          </button>
        </form>
      </div>
    </div>
  );
}
