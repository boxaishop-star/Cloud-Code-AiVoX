import express from 'express';
import { clerkMiddleware, getAuth, clerkClient } from '@clerk/express';
import {
  BusinessAssistantOrchestrator,
  PostgresStore,
  ClaudeExtractionProvider,
  getPrismaClient,
  getRoleFromClerkUser,
  computeReadiness,
  pickBestCard,
  resolveNichePack,
  type AdminDataStore,
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

app.get('/api/admin/tenants', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const user = await clerkClient.users.getUser(userId);
  const role = getRoleFromClerkUser({
    publicMetadata: user.publicMetadata as Record<string, unknown>,
  });

  if (role !== 'platform_owner') {
    res.status(403).json({ error: 'Forbidden: requires platform_owner role' });
    return;
  }

  // AUDIT LOG — раздел 19 ТЗ (временный console-лог до подключения audit-сервиса)
  console.log(`[AUDIT] actor=${userId} action=getAllTenants timestamp=${new Date().toISOString()}`);

  try {
    const store = new PostgresStore(getPrismaClient());
    const tenantIds = await (store as unknown as AdminDataStore).getAllTenants();

    const summaries = await Promise.all(
      tenantIds.map(async (tenant_id) => {
        const foundation = await store.getFoundation(tenant_id);
        return {
          tenant_id,
          company_description: foundation?.company_description ?? null,
          market_type: foundation?.market_type ?? null,
        };
      }),
    );

    res.json({ tenants: summaries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Раздел 7.1.1 ТЗ v9.0: минимальная утренняя сводка для Daily Assistant (Этап B).
// Реальные метрики Scout/Avi подключаются отдельно.
app.get('/api/daily-summary', async (req, res) => {
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

  try {
    const store = new PostgresStore(getPrismaClient());
    const [foundation, productCards, relationshipCards] = await Promise.all([
      store.getFoundation(rawTenantId),
      store.getProductCards(rawTenantId),
      store.getRelationshipCards(rawTenantId),
    ]);

    // Readiness рассчитывается локально — не тратим вызов LLM.
    const { computeReadiness } = await import('@aivox/core');
    const bestReadiness = productCards.length > 0
      ? Math.max(...productCards.map((c) => computeReadiness(c).readiness_score))
      : 0;

    res.json({
      tenant_id: rawTenantId,
      assistant_stage: (foundation as any)?.assistant_stage ?? 'profile_setup',
      product_cards_count: productCards.length,
      relationship_cards_count: relationshipCards.length,
      readiness_score: bestReadiness,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Раздел 7.1.2 ТЗ v9.1: план настройки карточки с вопросами, примерами и статусами.
// Никакой логики статусов на фронте — бэкенд считает и отдаёт готовый массив.
app.get('/api/setup-plan', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const tenantId = req.query.tenant_id as string | undefined;
  if (!tenantId) {
    res.status(400).json({ error: 'tenant_id query parameter is required' });
    return;
  }

  try {
    const store = new PostgresStore(getPrismaClient());
    const cards = await store.getProductCards(tenantId);
    if (cards.length === 0) {
      res.json({ plan: [], bestCard: null });
      return;
    }
    const bestCard = pickBestCard(cards)!;
    const foundation = await store.getFoundation(tenantId);
    const pack = resolveNichePack(bestCard, foundation ?? undefined);
    const { readiness_score, missing_fields, plan } = computeReadiness(bestCard, pack);
    res.json({ plan, readiness_score, missing_fields, bestCard: { id: bestCard.id, name: bestCard.name, service_line: bestCard.service_line } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
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
