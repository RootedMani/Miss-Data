import React, { useState } from 'react';
import { Settings as SettingsIcon, X, Check, Shield, Cpu, Sliders, Globe } from 'lucide-react';
import { AgentStatus } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  status: AgentStatus | null;
  onClose: () => void;
  onUpdateSettings: (newSettings: Partial<AgentStatus>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  status,
  onClose,
  onUpdateSettings,
}) => {
  if (!isOpen || !status) return null;

  const [provider, setProvider] = useState(status.provider);
  const [model, setModel] = useState(status.model);
  const [approvalMode, setApprovalMode] = useState(status.approvalMode);
  const [sandboxMode, setSandboxMode] = useState(status.sandboxMode);
  const [responseLanguage, setResponseLanguage] = useState(status.responseLanguage);
  const [budgetProfile, setBudgetProfile] = useState(status.budgetProfile);

  const handleSave = () => {
    onUpdateSettings({
      provider,
      model,
      approvalMode,
      sandboxMode,
      responseLanguage,
      budgetProfile,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-mono">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d] bg-[#0d1117]">
          <div className="flex items-center space-x-2">
            <SettingsIcon size={18} className="text-[#58a6ff]" />
            <h2 className="text-base font-bold text-[#f0f6fc]">Miss Data Configuration</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Settings Body */}
        <div className="p-6 space-y-5 text-xs text-[#c9d1d9] max-h-[70vh] overflow-y-auto">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="font-semibold text-[#f0f6fc] flex items-center gap-2">
              <Cpu size={14} className="text-[#58a6ff]" /> Active LLM Provider
            </label>
            <select
              value={provider}
              onChange={(e) => {
                const prov = e.target.value;
                setProvider(prov);
                if (prov === 'gemini') setModel('gemini-2.5-flash');
                else if (prov === 'groq') setModel('llama-3.3-70b-versatile');
                else if (prov === 'anthropic') setModel('claude-3-7-sonnet');
                else if (prov === 'deepseek') setModel('deepseek-chat');
                else if (prov === 'openai') setModel('gpt-4o');
                else if (prov === 'ollama') setModel('llama3.2');
              }}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-[#f0f6fc] outline-none"
            >
              <option value="gemini">Google Gemini (Recommended / Cloud Run)</option>
              <option value="groq">Groq (Fast / Free tier)</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="ollama">Ollama (Local loopback)</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
              <option value="together">Together AI</option>
              <option value="mistral">Mistral AI</option>
              <option value="fireworks">Fireworks</option>
              <option value="xai">xAI (Grok)</option>
              <option value="custom">Custom OpenAI-compatible</option>
            </select>
          </div>

          {/* Model Name */}
          <div className="space-y-2">
            <label className="font-semibold text-[#f0f6fc]">Model Name</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-[#f0f6fc] outline-none"
            />
          </div>

          {/* Approval Mode */}
          <div className="space-y-2">
            <label className="font-semibold text-[#f0f6fc] flex items-center gap-2">
              <Shield size={14} className="text-amber-400" /> Approval Policy (/approval)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['always', 'risky', 'auto'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setApprovalMode(mode)}
                  className={`p-2.5 rounded border text-left transition-colors capitalize ${
                    approvalMode === mode
                      ? 'border-[#58a6ff] bg-[#58a6ff]/10 text-[#58a6ff] font-bold'
                      : 'border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#8b949e]'
                  }`}
                >
                  <div className="font-medium">{mode}</div>
                  <div className="text-[10px] text-[#8b949e] mt-1">
                    {mode === 'risky' ? 'Confirm file edits & commands' : mode === 'always' ? 'Confirm every tool call' : 'Run freely without asking'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Sandbox Switch */}
          <div className="flex items-center justify-between p-3 bg-[#0d1117] border border-[#30363d] rounded-lg">
            <div>
              <div className="font-semibold text-[#f0f6fc]">Filesystem & Command Sandbox</div>
              <div className="text-[#8b949e] text-[11px]">Confine path operations to workspace root & block destructive shell commands</div>
            </div>
            <button
              type="button"
              onClick={() => setSandboxMode(!sandboxMode)}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                sandboxMode ? 'bg-emerald-600 text-white' : 'bg-[#21262d] text-[#8b949e]'
              }`}
            >
              {sandboxMode ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>

          {/* Output Budget */}
          <div className="space-y-2">
            <label className="font-semibold text-[#f0f6fc] flex items-center gap-2">
              <Sliders size={14} className="text-[#a371f7]" /> Output Budget Profile (/budget)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'economy', label: 'Economy (768 tkn)' },
                { id: 'balanced', label: 'Balanced (2048 tkn)' },
                { id: 'thorough', label: 'Thorough (4096 tkn)' },
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setBudgetProfile(b.id as any)}
                  className={`p-2 rounded border text-center transition-colors ${
                    budgetProfile === b.id
                      ? 'border-[#a371f7] bg-[#a371f7]/10 text-[#a371f7] font-semibold'
                      : 'border-[#30363d] bg-[#0d1117] text-[#8b949e]'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {/* Response Language */}
          <div className="space-y-2">
            <label className="font-semibold text-[#f0f6fc] flex items-center gap-2">
              <Globe size={14} className="text-[#7ee787]" /> Response Language (/lang)
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setResponseLanguage('en')}
                className={`px-4 py-2 rounded border transition-colors ${
                  responseLanguage === 'en' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 font-semibold' : 'border-[#30363d] bg-[#0d1117]'
                }`}
              >
                English (Default)
              </button>
              <button
                type="button"
                onClick={() => setResponseLanguage('fa')}
                className={`px-4 py-2 rounded border transition-colors ${
                  responseLanguage === 'fa' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400 font-semibold' : 'border-[#30363d] bg-[#0d1117]'
                }`}
              >
                Persian - فارسی (خانم داده)
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 px-6 py-3 border-t border-[#30363d] bg-[#0d1117]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md hover:bg-[#21262d] text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
