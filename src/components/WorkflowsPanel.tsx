import React from 'react';
import { 
  Map, 
  FlaskConical, 
  GitBranch, 
  Bookmark, 
  Gauge, 
  Search, 
  Activity, 
  ShieldCheck,
  Play
} from 'lucide-react';

interface WorkflowsPanelProps {
  onRunCommand: (cmd: string) => void;
}

export const WorkflowsPanel: React.FC<WorkflowsPanelProps> = ({ onRunCommand }) => {
  const workflows = [
    {
      id: 'map',
      title: 'Project Onboarding',
      command: '/map',
      desc: 'Local project overview detecting languages, manifests, and test scripts.',
      icon: <Map size={18} className="text-[#58a6ff]" />,
      badge: 'Local First',
    },
    {
      id: 'test',
      title: 'Test Discovery',
      command: '/test',
      desc: 'Infer test commands in the repository and run them through approval gating.',
      icon: <FlaskConical size={18} className="text-[#a371f7]" />,
      badge: 'Interactive',
    },
    {
      id: 'changes',
      title: 'Git Changes & Diff',
      command: '/changes',
      desc: 'Inspect modified files and read-only worktree differences without spending tokens.',
      icon: <GitBranch size={18} className="text-[#7ee787]" />,
      badge: 'No Model Cost',
    },
    {
      id: 'checkpoint',
      title: 'Checkpoints',
      command: '/checkpoints',
      desc: 'List or create reversible checkpoint snapshots of the workspace state.',
      icon: <Bookmark size={18} className="text-[#f0883e]" />,
      badge: 'Rollback Safe',
    },
    {
      id: 'context',
      title: 'Context Meter',
      command: '/context',
      desc: 'Estimated token and character consumption for the active conversation turn.',
      icon: <Gauge size={18} className="text-[#e3b341]" />,
      badge: 'Diagnostics',
    },
    {
      id: 'review',
      title: 'Code Review Mode',
      command: '/review src',
      desc: 'Starts a read-only analysis using safe inspection tools (no writes or deletions).',
      icon: <Search size={18} className="text-[#79c0ff]" />,
      badge: 'Read-only',
    },
    {
      id: 'doctor',
      title: 'System Diagnostics',
      command: '/doctor',
      desc: 'Check provider readiness, git health, and local Ollama server status.',
      icon: <Activity size={18} className="text-emerald-400" />,
      badge: 'Diagnostic',
    },
    {
      id: 'privacy',
      title: 'Privacy & Data Audit',
      command: '/privacy',
      desc: 'Display local session storage paths and audit retained activity logs.',
      icon: <ShieldCheck size={18} className="text-[#8b949e]" />,
      badge: 'Security',
    },
  ];

  return (
    <div className="h-full bg-[#0d1117] p-6 overflow-y-auto font-mono">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-lg font-bold text-[#f0f6fc] flex items-center gap-2">
            <span>Miss Data Workflows</span>
            <span className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
              Local-First
            </span>
          </h2>
          <p className="text-xs text-[#8b949e] mt-1">
            Built-in workflows designed to orient you and inspect code before spending provider tokens.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="border border-[#30363d] bg-[#161b22] hover:border-[#58a6ff]/50 rounded-lg p-4 transition-all flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    {wf.icon}
                    <span className="font-semibold text-sm text-[#f0f6fc]">{wf.title}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#21262d] text-[#8b949e] border border-[#30363d]">
                    {wf.badge}
                  </span>
                </div>
                <p className="text-xs text-[#8b949e] leading-relaxed">
                  {wf.desc}
                </p>
              </div>

              <div className="pt-4 flex items-center justify-between border-t border-[#30363d] mt-3">
                <code className="text-xs text-[#58a6ff] bg-[#0d1117] px-2 py-1 rounded border border-[#30363d]">
                  {wf.command}
                </code>
                <button
                  onClick={() => onRunCommand(wf.command)}
                  className="flex items-center space-x-1 px-3 py-1 rounded bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
                >
                  <Play size={12} />
                  <span>Run</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
