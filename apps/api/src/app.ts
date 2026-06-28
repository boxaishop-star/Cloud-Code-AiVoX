import express from 'express';
import { clerkMiddleware, getAuth, clerkClient } from '@clerk/express';
import {
  BusinessAssistantOrchestrator,
  PostgresStore,
  ClaudeExtractionProvider,
  getPrismaClient,
  getRoleFromClerkUser,
} from '@aivox/core';

export const app = express();

if (process.env.NODE_ENV !== 'production') {
  // TODO: убрать перед production / заменить на нормальный CORS-policy для реального фронтенда
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });
}

app.use(express.json());
app.use(clerkMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/chat', async (req, res) => {
  // tenant_id берётся ИСКЛЮЧИТЕЛЬНО из Clerk publicMetadata — раздел 9 ТЗ.
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await clerkClient.users.getUser(userId);

  const rawTenantId = user.publicMetadata['tenant_id'];
  if (typeof rawTenantId !== 'string' || !rawTenantId) {
    res.status(400).json({ error: 'tenant_id not configured for this user' });
    return;
  }

  // Роль доступна для будущего enforcement и аудита (раздел 9.1 ТЗ).
  const role = getRoleFromClerkUser({
    publicMetadata: user.publicMetadata as Record<string, unknown>,
  });

  const { userMessage } = req.body as { userMessage?: string };
  if (!userMessage) {
    res.status(400).json({ error: 'userMessage is required' });
    return;
  }

  try {
    const store = new PostgresStore(getPrismaClient());
    const extractor = new ClaudeExtractionProvider();
    const orch = new BusinessAssistantOrchestrator(store, extractor);
    const result = await orch.process({ userMessage, tenant_id: rawTenantId });
    res.json({ ...result, _auth: { role } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});
