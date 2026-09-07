import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { AgentService } from './server/agent.js';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const agent = new AgentService();

// API routes FIRST
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'Miss Data' });
});

app.get('/api/status', (req, res) => {
  res.json(agent.getStatus());
});

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    const message = await agent.processUserMessage(prompt);
    res.json({
      message,
      messages: agent.messages,
      status: agent.getStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/approval', async (req, res) => {
  try {
    const { messageId, action } = req.body;
    if (!messageId || !['approve', 'always', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid approval request' });
    }
    const message = await agent.resolveApproval(messageId, action);
    res.json({
      message,
      messages: agent.messages,
      status: agent.getStatus(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files', (req, res) => {
  const dir = (req.query.path as string) || '.';
  const list = agent.sandbox.listDir(dir, 4);
  res.json(list);
});

app.get('/api/file', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'Path query param required' });
  const result = agent.sandbox.readFile(filePath);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

app.post('/api/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) return res.status(400).json({ error: 'path and content required' });
  const result = agent.sandbox.writeFile(filePath, content);
  res.json(result);
});

app.get('/api/manual', (req, res) => {
  const query = req.query.q as string;
  const { searchManual, MANUAL_PAGES } = require('./server/manual.js');
  if (query) {
    res.json(searchManual(query));
  } else {
    res.json(Object.values(MANUAL_PAGES));
  }
});

app.get('/api/manual/:topic', (req, res) => {
  const topic = req.params.topic.toLowerCase();
  const { MANUAL_PAGES } = require('./server/manual.js');
  const page = MANUAL_PAGES[topic];
  if (!page) return res.status(404).json({ error: 'Topic not found' });
  res.json(page);
});

app.get('/api/memory', (req, res) => {
  res.json({ facts: agent.memoryFacts });
});

app.post('/api/memory/add', (req, res) => {
  const { fact } = req.body;
  if (!fact || typeof fact !== 'string') return res.status(400).json({ error: 'fact required' });
  const id = agent.memoryFacts.length > 0 ? Math.max(...agent.memoryFacts.map(f => f.id)) + 1 : 1;
  agent.memoryFacts.push({ id, fact: fact.trim(), createdAt: Date.now() });
  res.json({ success: true, facts: agent.memoryFacts });
});

app.delete('/api/memory/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const idx = agent.memoryFacts.findIndex(f => f.id === id);
  if (idx !== -1) {
    agent.memoryFacts.splice(idx, 1);
  }
  res.json({ success: true, facts: agent.memoryFacts });
});

// Git status and operations
app.get('/api/git/status', (req, res) => {
  const { getGitStatus } = require('./server/git.js');
  const status = getGitStatus(agent.sandbox.cwd);
  res.json(status);
});

app.get('/api/git/diff', (req, res) => {
  const { getGitDiff } = require('./server/git.js');
  const diff = getGitDiff(agent.sandbox.cwd);
  res.json({ diff });
});

app.post('/api/git/action', (req, res) => {
  const { action, message } = req.body;
  const { performGitAction } = require('./server/git.js');
  const result = performGitAction(action, agent.sandbox.cwd, { message });
  if (action === 'discard' || action === 'reset-upstream') {
    agent.touchedFiles.clear();
  }
  res.json(result);
});

// Direct shell execution in sandbox
app.post('/api/terminal/exec', (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') return res.status(400).json({ error: 'command required' });
  const result = agent.sandbox.runCommand(command);
  res.json(result);
});

app.post('/api/config', (req, res) => {
  const updates = req.body;
  if (updates.provider) agent.settings.provider = updates.provider;
  if (updates.model) agent.settings.model = updates.model;
  if (updates.approvalMode) agent.settings.approvalMode = updates.approvalMode;
  if (updates.sandboxMode !== undefined) {
    agent.settings.sandboxMode = Boolean(updates.sandboxMode);
    agent.sandbox.sandboxMode = agent.settings.sandboxMode;
  }
  if (updates.responseLanguage) agent.settings.responseLanguage = updates.responseLanguage;
  if (updates.budgetProfile) agent.settings.budgetProfile = updates.budgetProfile;
  if (updates.maxOutputTokens) agent.settings.maxOutputTokens = updates.maxOutputTokens;
  if (updates.executionMode) agent.settings.executionMode = updates.executionMode;
  res.json(agent.getStatus());
});

app.get('/api/sessions', (req, res) => {
  const list = Array.from(agent.sessions.entries()).map(([id, s]) => ({
    id,
    title: s.title,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  }));
  res.json({ sessions: list, currentId: agent.currentSessionId });
});

app.post('/api/sessions', (req, res) => {
  const { action, id, title } = req.body;
  if (action === 'new') {
    const newId = `session-${Date.now().toString(36)}`;
    agent.sessions.set(newId, {
      title: title || `Session ${new Date().toLocaleTimeString()}`,
      messages: [],
      updatedAt: Date.now(),
    });
    agent.currentSessionId = newId;
    agent.messages = [];
  } else if (action === 'switch' && id && agent.sessions.has(id)) {
    // Save current
    const current = agent.sessions.get(agent.currentSessionId);
    if (current) {
      current.messages = [...agent.messages];
      current.updatedAt = Date.now();
    }
    // Switch
    agent.currentSessionId = id;
    const target = agent.sessions.get(id)!;
    agent.messages = [...target.messages];
  } else if (action === 'rename' && id && title && agent.sessions.has(id)) {
    agent.sessions.get(id)!.title = title;
  }
  res.json({ currentId: agent.currentSessionId, sessions: Array.from(agent.sessions.entries()) });
});

// Vite middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Miss Data Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
