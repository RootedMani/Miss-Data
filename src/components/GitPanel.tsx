import React, { useState, useEffect } from 'react';
import { 
  GitBranch, 
  GitPullRequest, 
  RefreshCw, 
  Trash2, 
  Archive, 
  Bookmark, 
  AlertTriangle, 
  CheckCircle2, 
  FileText, 
  ExternalLink, 
  RotateCcw,
  Zap,
  Terminal as TerminalIcon,
  Copy,
  Check
} from 'lucide-react';
import { GitStatus } from '../types';

interface GitPanelProps {
  onRunTerminalCommand?: (cmd: string) => void;
}

export function GitPanel({ onRunTerminalCommand }: GitPanelProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [actionLog, setActionLog] = useState<string>('');
  const [checkpointMsg, setCheckpointMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'diff' | 'history'>('overview');

  const fetchGitStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/git/status');
      const data = await res.json();
      setGitStatus(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchDiff = async () => {
    try {
      const res = await fetch('/api/git/diff');
      const data = await res.json();
      setDiffText(data.diff || '');
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchGitStatus();
    fetchDiff();
  }, []);

  const handleGitAction = async (action: 'discard' | 'reset-upstream' | 'stash' | 'stash-pop' | 'checkpoint' | 'rebase' | 'pull-ff', message?: string) => {
    setLoading(true);
    setActionLog(`Executing: git action '${action}'...`);
    try {
      const res = await fetch('/api/git/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, message }),
      });
      const data = await res.json();
      setActionLog(data.output || (data.success ? 'Operation completed successfully.' : 'Operation failed.'));
      if (data.status) {
        setGitStatus(data.status);
      } else {
        fetchGitStatus();
      }
      fetchDiff();
    } catch (e: any) {
      setActionLog(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#e6edf3] font-mono text-xs overflow-hidden">
      {/* Top Bar */}
      <div className="h-12 px-4 border-b border-[#30363d] bg-[#161b22] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <GitBranch size={16} className="text-[#58a6ff]" />
          <span className="font-semibold text-sm text-[#f0f6fc]">Git & Update Manager</span>
          <span className="px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] text-[11px] border border-[#30363d]">
            branch: {gitStatus?.branch || 'main'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex rounded-md bg-[#21262d] p-0.5 border border-[#30363d]">
            <button
              onClick={() => setActiveSubTab('overview')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                activeSubTab === 'overview' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => { setActiveSubTab('diff'); fetchDiff(); }}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                activeSubTab === 'diff' ? 'bg-[#30363d] text-white' : 'text-[#8b949e] hover:text-[#c9d1d9]'
              }`}
            >
              Diff ({gitStatus ? gitStatus.modifiedFiles.length + gitStatus.untrackedFiles.length : 0})
            </button>
          </div>

          <button
            onClick={() => { fetchGitStatus(); fetchDiff(); }}
            disabled={loading}
            className="flex items-center space-x-1 px-2.5 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Error / Diverged / Dirty Warning Banners */}
        {gitStatus?.diverged && (
          <div className="p-3.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm text-amber-300">
                  Diverging Branches Detected (Ahead: {gitStatus.ahead}, Behind: {gitStatus.behind})
                </div>
                <div className="text-xs text-amber-200/80 mt-0.5 leading-relaxed">
                  Fast-forward cannot complete automatically because your local branch has {gitStatus.ahead} local commit(s) while upstream has {gitStatus.behind} new commit(s).
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => handleGitAction('reset-upstream')}
                disabled={loading}
                className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs transition-colors flex items-center space-x-1.5"
                title="Fetches official remote and hard-resets to origin/main"
              >
                <Zap size={13} />
                <span>1-Click Fix: Reset to Upstream</span>
              </button>
              <button
                onClick={() => handleGitAction('rebase')}
                disabled={loading}
                className="px-2.5 py-1.5 rounded-md bg-[#21262d] hover:bg-[#30363d] text-amber-200 border border-amber-500/30 text-xs transition-colors"
                title="Rebases your local commits on top of origin/main"
              >
                Rebase
              </button>
            </div>
          </div>
        )}

        {!gitStatus?.isClean && (
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-amber-500/30 text-[#e6edf3] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-3">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-xs text-[#f0f6fc]">
                  Working Tree Has Local Changes ({gitStatus ? gitStatus.modifiedFiles.length + gitStatus.untrackedFiles.length : 0} files)
                </div>
                <div className="text-[11px] text-[#8b949e] mt-0.5">
                  Miss Data requires a clean working tree before running fast-forward updates.
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => handleGitAction('discard')}
                disabled={loading}
                className="px-2.5 py-1.5 rounded bg-rose-900/40 hover:bg-rose-900/60 text-rose-300 border border-rose-700/50 text-xs transition-colors flex items-center space-x-1"
                title="git restore . && git clean -fd"
              >
                <Trash2 size={12} />
                <span>Discard Changes</span>
              </button>
              <button
                onClick={() => handleGitAction('stash')}
                disabled={loading}
                className="px-2.5 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] text-xs transition-colors flex items-center space-x-1"
                title="git stash -u"
              >
                <Archive size={12} />
                <span>Stash</span>
              </button>
            </div>
          </div>
        )}

        {/* Action Panel / Quick Operations Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card 1: Official Remote Sync */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-xs text-[#58a6ff]">Upstream Repository</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">Official</span>
              </div>
              <p className="text-[11px] text-[#8b949e] break-all mb-3 leading-relaxed">
                {gitStatus?.remoteUrl || 'https://github.com/RootedMani/Miss-Data.git'}
              </p>
            </div>
            <div className="flex items-center space-x-2 pt-2 border-t border-[#30363d]">
              <button
                onClick={() => handleGitAction('pull-ff')}
                disabled={loading}
                className="flex-1 py-1.5 rounded bg-[#238636] hover:bg-[#2ea043] text-white font-semibold text-xs transition-colors flex items-center justify-center space-x-1.5 disabled:opacity-50"
              >
                <GitPullRequest size={13} />
                <span>/update apply (Fast-Forward)</span>
              </button>
            </div>
          </div>

          {/* Card 2: Discard & Clean Safety Net */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-xs text-rose-400">Discard & Reset</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-800/40">Clean</span>
              </div>
              <p className="text-[11px] text-[#8b949e] mb-3 leading-relaxed">
                Permanently throw away uncommitted edits and untracked files, restoring clean tracking.
              </p>
            </div>
            <div className="flex items-center space-x-2 pt-2 border-t border-[#30363d]">
              <button
                onClick={() => handleGitAction('discard')}
                disabled={loading}
                className="flex-1 py-1.5 rounded bg-[#21262d] hover:bg-rose-950/40 text-rose-300 border border-rose-800/40 text-xs transition-colors flex items-center justify-center space-x-1"
              >
                <Trash2 size={12} />
                <span>Discard Working Changes</span>
              </button>
              <button
                onClick={() => handleGitAction('reset-upstream')}
                disabled={loading}
                className="py-1.5 px-2 rounded bg-[#21262d] hover:bg-amber-950/40 text-amber-300 border border-amber-800/40 text-xs transition-colors"
                title="Reset local branch to origin/main"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          </div>

          {/* Card 3: Checkpoint & Stash */}
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-xs text-[#a371f7]">Checkpoints & Stash</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#8b949e]">Safe Storage</span>
              </div>
              <div className="flex space-x-1.5 mb-2">
                <input
                  type="text"
                  placeholder="Checkpoint commit note..."
                  value={checkpointMsg}
                  onChange={(e) => setCheckpointMsg(e.target.value)}
                  className="flex-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1 text-xs text-[#c9d1d9] focus:outline-none focus:border-[#58a6ff]"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2 pt-2 border-t border-[#30363d]">
              <button
                onClick={() => { handleGitAction('checkpoint', checkpointMsg); setCheckpointMsg(''); }}
                disabled={loading || !checkpointMsg.trim()}
                className="flex-1 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] text-xs transition-colors flex items-center justify-center space-x-1 disabled:opacity-50"
              >
                <Bookmark size={12} />
                <span>Save Checkpoint</span>
              </button>
              <button
                onClick={() => handleGitAction('stash-pop')}
                disabled={loading}
                className="py-1.5 px-2.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] border border-[#30363d] text-xs transition-colors"
                title="Pop stashed changes"
              >
                Pop Stash
              </button>
            </div>
          </div>
        </div>

        {/* Action Log / Feedback Console */}
        {actionLog && (
          <div className="p-3 rounded-lg bg-[#161b22] border border-[#30363d]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-[#8b949e] flex items-center space-x-1.5">
                <TerminalIcon size={12} />
                <span>Git Action Result</span>
              </span>
              <button
                onClick={() => setActionLog('')}
                className="text-[10px] text-[#8b949e] hover:text-[#c9d1d9]"
              >
                Clear
              </button>
            </div>
            <pre className="text-xs text-[#7ee787] whitespace-pre-wrap font-mono max-h-36 overflow-y-auto leading-relaxed bg-[#0d1117] p-2 rounded border border-[#30363d]/50">
              {actionLog}
            </pre>
          </div>
        )}

        {/* SubTab Views */}
        {activeSubTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Modified Files */}
            <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-xs text-[#f0f6fc]">
                  Modified Tracked Files ({gitStatus?.modifiedFiles.length || 0})
                </span>
                {gitStatus?.modifiedFiles.length ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                    Dirty
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                    Clean
                  </span>
                )}
              </div>

              {gitStatus?.modifiedFiles && gitStatus.modifiedFiles.length > 0 ? (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {gitStatus.modifiedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-1.5 rounded bg-[#0d1117] border border-[#30363d]/50 text-xs"
                    >
                      <span className="text-amber-300 font-mono truncate">{file}</span>
                      <span className="text-[10px] text-[#8b949e]">modified</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[#8b949e] py-4 text-center">
                  No modified tracked files.
                </div>
              )}
            </div>

            {/* Untracked Files */}
            <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-xs text-[#f0f6fc]">
                  Untracked Files ({gitStatus?.untrackedFiles.length || 0})
                </span>
                {gitStatus?.untrackedFiles.length ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40">
                    New
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                    Clean
                  </span>
                )}
              </div>

              {gitStatus?.untrackedFiles && gitStatus.untrackedFiles.length > 0 ? (
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {gitStatus.untrackedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-1.5 rounded bg-[#0d1117] border border-[#30363d]/50 text-xs"
                    >
                      <span className="text-blue-300 font-mono truncate">{file}</span>
                      <span className="text-[10px] text-[#8b949e]">untracked</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-[#8b949e] py-4 text-center">
                  No untracked files.
                </div>
              )}
            </div>
          </div>
        )}

        {activeSubTab === 'diff' && (
          <div className="p-3.5 rounded-lg bg-[#161b22] border border-[#30363d]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-xs text-[#f0f6fc] flex items-center space-x-1.5">
                <FileText size={13} className="text-[#58a6ff]" />
                <span>Working Tree Diff (`git diff`)</span>
              </span>
              <button
                onClick={() => copyToClipboard(diffText)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-[#c9d1d9] text-[11px]"
              >
                {copied ? <Check size={11} className="text-[#7ee787]" /> : <Copy size={11} />}
                <span>{copied ? 'Copied' : 'Copy Diff'}</span>
              </button>
            </div>

            <pre className="p-3 rounded bg-[#0d1117] border border-[#30363d] text-xs font-mono overflow-x-auto max-h-[400px] leading-relaxed">
              {diffText ? (
                diffText.split('\n').map((line, i) => {
                  let colorClass = 'text-[#c9d1d9]';
                  if (line.startsWith('+') && !line.startsWith('+++')) colorClass = 'text-emerald-400 bg-emerald-950/20';
                  else if (line.startsWith('-') && !line.startsWith('---')) colorClass = 'text-rose-400 bg-rose-950/20';
                  else if (line.startsWith('@@')) colorClass = 'text-[#58a6ff]';
                  return (
                    <div key={i} className={colorClass}>
                      {line}
                    </div>
                  );
                })
              ) : (
                <span className="text-[#8b949e]">Working tree is clean. No uncommitted diffs.</span>
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
