import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// ── Research finding: createSignInToken is NOT usable as Bearer token ─────────
//
// clerkClient.signInTokens.createSignInToken() returns a sign-in ticket JWT
// (RS256, claims: eis, exp — no sub or sid). Clerk's getAuth() verifies session
// JWTs (claims: sub=userId, sid=sessionId). The two token types are different:
//
//   sign-in token  → frontend flow only (visited via __clerk_ticket URL param)
//   session JWT    → issued by Clerk frontend SDK after sign-in completes
//
// Clerk Backend API has NO method to mint a session JWT without a browser
// sign-in flow (SessionAPI only has getSessionList/getSession/revokeSession/
// verifySession/getToken — all require an existing session, not create one).
//
// Correct approach for backend integration tests: mock the Clerk auth layer,
// test real business logic (orchestrator → Claude API → Postgres). This
// correctly proves that tenant_id is read from publicMetadata, not body.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  // Simulate Clerk behaviour: Bearer header present = signed in, absent = 401
  getAuth: (req: any) =>
    req.headers.authorization?.startsWith('Bearer ')
      ? { userId: process.env.TEST_CLERK_USER_ID ?? 'test-user-id' }
      : { userId: null },
  clerkClient: {
    users: {
      // Returns the test user's publicMetadata — tenant_id must come from here,
      // NOT from the request body (that's the security invariant under test).
      getUser: async (_userId: string) => ({
        publicMetadata: { tenant_id: 'manual_test_1', role: 'tenant_user' },
      }),
    },
  },
}));

import { app } from '../../src/app.js';
import { getPrismaClient } from '@aivox/core';

const MANICURE_MESSAGE =
  'Хочу настроить услугу маникюр классический. Цена 1500 рублей за сеанс. ' +
  'Входит снятие старого покрытия, уход за кутикулой, покрытие гель-лаком. ' +
  'Клиенты — женщины 20-45 лет. Работаем в Москве.';

// tenant_id взят из publicMetadata тестового пользователя — не из тела запроса.
const TENANT_ID = 'manual_test_1';

const canRunE2E =
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.DATABASE_URL &&
  !!process.env.TEST_CLERK_USER_ID;

// Очищаем состояние ДО теста — карточки от предыдущих прогонов (e2e-скриптов,
// ручных curl-тестов и т.д.) заставляют Claude предлагать update вместо upsert.
beforeAll(async () => {
  if (!canRunE2E) return;
  const client = getPrismaClient();
  await client.productCard.deleteMany({ where: { tenant_id: TENANT_ID } }).catch(() => {});
});

afterAll(async () => {
  if (!canRunE2E) return;
  const client = getPrismaClient();
  await client.productCard.deleteMany({ where: { tenant_id: TENANT_ID } }).catch(() => {});
});

describe('POST /api/chat', () => {
  it('GET /health returns { status: "ok" }', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns 401 for request without Authorization header', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ userMessage: 'привет' })
      .expect(401);
    expect(res.body.error).toBeTruthy();
  });

  it.skipIf(!canRunE2E)(
    'e2e: tenant_id берётся из Clerk publicMetadata, а не из тела запроса',
    async () => {
      const res = await request(app)
        .post('/api/chat')
        .set('Authorization', 'Bearer mock-signed-in')
        // tenant_id намеренно НЕ передаётся в теле — это и есть проверка уязвимости
        .send({ userMessage: MANICURE_MESSAGE })
        .expect(200);

      expect(res.body.intent).toBeTruthy();

      const applied = (res.body.appliedActions as any[]).find(
        (a: any) => a.action.type === 'upsert_product_card',
      );
      expect(applied?.applied).toBe(true);

      // Ключевое утверждение: tenant_id в созданной карточке = 'manual_test_1'
      // (из publicMetadata), а не какое-то значение из тела запроса.
      expect((applied?.action.payload as any).tenant_id).toBe('manual_test_1');
    },
    30000,
  );
});
