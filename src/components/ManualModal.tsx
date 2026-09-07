import React, { useState, useEffect } from 'react';
import { BookOpen, Search, X, ShieldAlert, CheckCircle } from 'lucide-react';
import { ManualPage } from '../types';

interface ManualModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRunExample?: (cmd: string) => void;
}

export const ManualModal: React.FC<ManualModalProps> = ({ isOpen, onClose, onRunExample }) => {
  const [pages, setPages] = useState<ManualPage[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>('getting-started');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      fetchPages();
    }
  }, [isOpen]);

  const fetchPages = async (query: string = '') => {
    setLoading(true);
    try {
      const url = query ? `/api/manual?q=${encodeURIComponent(query)}` : '/api/manual';
      const res = await fetch(url);
      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setPages(data);
        if (data.length > 0 && !data.some((p: ManualPage) => p.name === selectedTopic)) {
          setSelectedTopic(data[0].name);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPages(searchQuery);
  };

  if (!isOpen) return null;

  const activePage = pages.find(p => p.name === selectedTopic) || pages[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-mono">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center space-x-2">
            <BookOpen size={18} className="text-[#58a6ff]" />
            <h2 className="text-base font-bold text-[#f0f6fc]">Miss Data In-Program Manual (/man)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Topics & Search */}
          <div className="w-64 border-r border-[#30363d] flex flex-col bg-[#0d1117]/60">
            <form onSubmit={handleSearch} className="p-3 border-b border-[#30363d]">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-[#8b949e]" />
                <input
                  type="text"
                  placeholder="Search manual..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#161b22] border border-[#30363d] rounded-md text-xs text-[#f0f6fc] placeholder-[#8b949e] outline-none focus:border-[#58a6ff]"
                />
              </div>
            </form>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {pages.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setSelectedTopic(p.name)}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center justify-between ${
                    selectedTopic === p.name 
                      ? 'bg-[#21262d] text-[#58a6ff] font-semibold border-l-2 border-[#58a6ff]' 
                      : 'text-[#8b949e] hover:bg-[#21262d]/50 hover:text-[#c9d1d9]'
                  }`}
                >
                  <span className="capitalize">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Manual Page Viewer */}
          <div className="flex-1 overflow-y-auto p-6 bg-[#0d1117] text-[#c9d1d9] space-y-5">
            {activePage ? (
              <>
                <div>
                  <h1 className="text-xl font-bold text-[#f0f6fc] capitalize flex items-center gap-2">
                    {activePage.name}
                  </h1>
                  <div className="mt-2 p-2 bg-[#161b22] border border-[#30363d] rounded text-xs text-[#58a6ff] font-mono">
                    {activePage.synopsis}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase font-bold text-[#8b949e] tracking-wider mb-2">Description</h3>
                  <p className="text-sm text-[#c9d1d9] leading-relaxed">
                    {activePage.description}
                  </p>
                </div>

                {activePage.examples && activePage.examples.length > 0 && (
                  <div>
                    <h3 className="text-xs uppercase font-bold text-[#8b949e] tracking-wider mb-2">Examples</h3>
                    <div className="space-y-1.5">
                      {activePage.examples.map((ex, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-[#161b22] border border-[#30363d] rounded text-xs">
                          <code className="text-[#a371f7]">{ex}</code>
                          {onRunExample && (
                            <button
                              onClick={() => {
                                onRunExample(ex);
                                onClose();
                              }}
                              className="px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#58a6ff] text-[11px]"
                            >
                              Run
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activePage.safety && (
                  <div className="border border-amber-500/40 bg-amber-950/20 rounded-lg p-3 text-xs text-amber-300 flex items-start space-x-2">
                    <ShieldAlert size={16} className="shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Safety Boundary:</span> {activePage.safety}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-[#8b949e]">No manual topic selected</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
