export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  touchedFiles?: string[];
  pendingApproval?: PendingApproval;
  status?: 'thinking' | 'done' | 'stopped' | 'error';
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface PendingApproval {
  toolCall: ToolCall;
  description: string;
  isRisky: boolean;
}

export interface AgentStatus {
  provider: string;
  model: string;
  cwd: string;
  approvalMode: 'always' | 'risky' | 'auto';
  sandboxMode: boolean;
  budgetProfile: 'economy' | 'balanced' | 'thorough' | 'custom';
  maxOutputTokens: number;
  responseLanguage: 'en' | 'fa';
  executionMode: 'direct' | 'plan';
  contextRecovery: 'ask' | 'auto' | 'off';
  ollamaRecovery: 'ask' | 'auto' | 'off';
  memoryCount: number;
  sessionTitle: string;
  sessionId: string;
  touchedFilesCount: number;
  availableProviders: string[];
  configuredKeys: Record<string, boolean>;
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface ManualPage {
  name: string;
  synopsis: string;
  description: string;
  examples: string[];
  safety?: string;
  aliases?: string[];
}

export interface SessionItem {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}
