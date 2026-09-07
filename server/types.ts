export interface AgentSettings {
  provider: string;
  model: string;
  approvalMode: 'always' | 'risky' | 'auto';
  sandboxMode: boolean;
  budgetProfile: 'economy' | 'balanced' | 'thorough' | 'custom';
  maxOutputTokens: number;
  responseLanguage: 'en' | 'fa';
  executionMode: 'direct' | 'plan';
  contextRecovery: 'ask' | 'auto' | 'off';
  ollamaRecovery: 'ask' | 'auto' | 'off';
  ollamaUrl: string;
  baseUrl: string;
  fallbackProviders: string[];
}

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

export interface MemoryFact {
  id: number;
  fact: string;
  createdAt: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface ActivityLogEvent {
  timestamp: string;
  event: string;
  data: Record<string, any>;
}
