import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FileText, 
  RefreshCw, 
  Edit3, 
  Save, 
  Plus, 
  Sparkles,
  Code,
  FileCode,
  File
} from 'lucide-react';
import { FileItem } from '../types';

interface WorkspaceExplorerProps {
  onAskAgent: (prompt: string) => void;
}

export const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = ({ onAskAgent }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      if (data.items) {
        setFiles(data.items);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const openFile = async (filePath: string) => {
    setSelectedPath(filePath);
    setIsEditing(false);
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.content !== undefined) {
        setFileContent(data.content);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveFile = async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content: fileContent }),
      });
      const data = await res.json();
      if (data.success) {
        setIsEditing(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.js')) {
      return <FileCode size={14} className="text-[#58a6ff]" />;
    }
    if (fileName.endsWith('.json') || fileName.endsWith('.md')) {
      return <FileText size={14} className="text-[#e3b341]" />;
    }
    return <File size={14} className="text-[#8b949e]" />;
  };

  return (
    <div className="flex h-full bg-[#0d1117] text-[#c9d1d9] font-mono text-xs overflow-hidden">
      {/* Sidebar: File List */}
      <div className="w-64 border-r border-[#30363d] flex flex-col bg-[#161b22]">
        <div className="flex items-center justify-between p-3 border-b border-[#30363d]">
          <span className="font-semibold text-[#f0f6fc] flex items-center gap-1.5">
            <Folder size={14} className="text-[#58a6ff]" /> Workspace Files
          </span>
          <button
            onClick={fetchFiles}
            disabled={loading}
            className="p-1 hover:bg-[#30363d] rounded text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
            title="Refresh files"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {files.map((file) => (
            <button
              key={file.path}
              onClick={() => file.type === 'file' && openFile(file.path)}
              className={`w-full flex items-center space-x-2 px-2 py-1.5 rounded text-left transition-colors truncate ${
                selectedPath === file.path 
                  ? 'bg-[#21262d] text-[#58a6ff] font-medium' 
                  : 'hover:bg-[#21262d]/50 text-[#c9d1d9]'
              }`}
            >
              {file.type === 'directory' ? (
                <Folder size={14} className="text-[#79c0ff] shrink-0" />
              ) : (
                getFileIcon(file.name)
              )}
              <span className="truncate">{file.path}</span>
            </button>
          ))}
          {files.length === 0 && !loading && (
            <div className="text-center p-4 text-[#8b949e]">No files found</div>
          )}
        </div>
      </div>

      {/* Editor / File Viewer Area */}
      <div className="flex-1 flex flex-col bg-[#0d1117]">
        {selectedPath ? (
          <>
            {/* Action Bar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363d] bg-[#161b22]">
              <div className="flex items-center space-x-2 truncate">
                <span className="font-medium text-[#f0f6fc]">{selectedPath}</span>
                {isEditing && <span className="text-[10px] text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded">Editing</span>}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => onAskAgent(`Please review and explain what ${selectedPath} does.`)}
                  className="flex items-center space-x-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#a371f7] border border-[#30363d] transition-colors"
                  title="Ask Miss Data to inspect"
                >
                  <Sparkles size={12} />
                  <span>Explain</span>
                </button>

                {isEditing ? (
                  <button
                    onClick={saveFile}
                    disabled={saving}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                  >
                    <Save size={12} />
                    <span>{saving ? 'Saving...' : 'Save'}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center space-x-1 px-2 py-1 rounded bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border border-[#30363d] transition-colors"
                  >
                    <Edit3 size={12} />
                    <span>Edit</span>
                  </button>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs">
              {isEditing ? (
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="w-full h-full bg-transparent text-[#e6edf3] font-mono outline-none resize-none"
                  spellCheck={false}
                />
              ) : (
                <pre className="text-[#c9d1d9] leading-relaxed whitespace-pre-wrap font-mono">
                  {fileContent || '// Empty file'}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-[#8b949e] p-8 space-y-3">
            <Code size={36} className="text-[#30363d]" />
            <p>Select a file from the explorer to view or edit.</p>
            <p className="text-[11px] text-[#484f58]">Miss Data tools (`read_file`, `write_file`, `edit_file`) operate in this sandbox.</p>
          </div>
        )}
      </div>
    </div>
  );
};
