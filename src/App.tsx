import React, { useState, useEffect } from 'react';
import { Terminal } from './components/Terminal';
import { Message, AgentStatus } from './types';

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [latency, setLatency] = useState<number | null>(null);

  const fetchStatus = async () => {
    try {
      const startTime = performance.now();
      const res = await fetch('/api/status');
      const roundTrip = Math.round(performance.now() - startTime);
      setLatency(roundTrip);

      if (!res.ok) return;
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) return;
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('Error fetching status:', e);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Poll status periodically (every 5 seconds) to keep memory usage and latency fresh
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    }, 5000);

    // Global shortcut Ctrl+L to clear terminal
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    // Check for local clear
    if (text.trim() === 'clear' || text.trim() === '/clear') {
      handleClear();
      return;
    }

    setLoading(true);

    // Optimistically append user message to avoid delay
    const tempUserId = `user-${Date.now()}`;
    const userMsg: Message = {
      id: tempUserId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.messages) {
        setMessages(data.messages);
      }
      if (data.status) {
        setStatus(data.status);
      }
    } catch (e: any) {
      console.error(e);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `[Error communicating with Miss Data]: ${e.message || 'Connection failed'}`,
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
    } catch (e: any) {
      console.error(e);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `[Approval Error]: ${e.message}`,
          timestamp: Date.now(),
          status: 'error',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setMessages([]);
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '/clear' }),
      });
    } catch (e) {
      // Local clear already executed
    }
  };

  const handleToggleLanguage = async () => {
    const next = status?.responseLanguage === 'fa' ? 'en' : 'fa';
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseLanguage: next }),
      });
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error(e);
    }
    handleSendMessage(`/lang ${next}`);
  };

  return (
    <Terminal
      messages={messages}
      status={status}
      loading={loading}
      latency={latency}
      onSendMessage={handleSendMessage}
      onResolveApproval={handleResolveApproval}
      onClear={handleClear}
      onToggleLanguage={handleToggleLanguage}
    />
  );
}
export default App;
