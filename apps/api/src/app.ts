import express from 'express';
import {
  BusinessAssistantOrchestrator,
  PostgresStore,
  ClaudeExtractionProvider,
  getPrismaClient,
} from '@aivox/core';

export const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/chat', async (req, res) => {
  const { userMessage, tenant_id } = req.body as { userMessage?: string; tenant_id?: string };
  if (!userMessage || !tenant_id) {
    res.status(400).json({ error: 'userMessage and tenant_id are required' });
    return;
  }

  try {
    const store = new PostgresStore(getPrismaClient());
    const extractor = new ClaudeExtractionProvider();
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage, tenant_id });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
