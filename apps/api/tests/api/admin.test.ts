import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Мок @clerk/express — роль определяется по значению Bearer-токена,
// чтобы один файл тестировал все три сценария (401 / 403 / 200).
vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_req: any, _res: any, next: any) => next(),
  getAuth: (req: any) => {
    if (!req.headers.authorization?.startsWith('Bearer ')) return { userId: null };
    const token = req.headers.authorization.slice(7);
    if (token === 'owner-token') return { userId: 'owner-uid' };
    return { userId: 'tenant-uid' };
  },
  clerkClient: {
    users: {
      getUser: async (userId: string) => {
        if (userId === 'owner-uid') {
          return { publicMetadata: { role: 'platform_owner' } };
        }
        return { publicMetadata: { tenant_id: 'manual_test_1', role: 'tenant_user' } };
      },
    },
  },
}));

import { app } from '../../src/app.js';
import { getPrismaClient } from '@aivox/core';

const ADMIN_TENANT = 'admin_e2e_' + Math.random().toString(36).slice(2, 8);

const canRunE2E = !!process.env.DATABASE_URL;

beforeAll(async () => {
  if (!canRunE2E) return;
  const client = getPrismaClient();
  await client.businessFoundation.upsert({
    where: { tenant_id: ADMIN_TENANT },
    create: {
      tenant_id: ADMIN_TENANT,
      company_description: 'E2E тест Owner Console',
      market_type: 'B2C',
      updated_at: new Date().toISOString(),
    },
    update: {
      company_description: 'E2E тест Owner Console',
      updated_at: new Date().toISOString(),
    },
  });
});

afterAll(async () => {
  if (!canRunE2E) return;
  const client = getPrismaClient();
  await client.businessFoundation
    .deleteMany({ where: { tenant_id: ADMIN_TENANT } })
    .catch(() => {});
});

describe('GET /api/admin/tenants', () => {
  it('возвращает 401 без токена', async () => {
    const res = await request(app).get('/api/admin/tenants').expect(401);
    expect(res.body.error).toBeTruthy();
  });

  it('возвращает 403 для tenant_user', async () => {
    const res = await request(app)
      .get('/api/admin/tenants')
      .set('Authorization', 'Bearer regular-token')
      .expect(403);
    expect(res.body.error).toMatch(/platform_owner/);
  });

  it.skipIf(!canRunE2E)(
    'возвращает 200 + список для platform_owner',
    async () => {
      const res = await request(app)
        .get('/api/admin/tenants')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);

      expect(Array.isArray(res.body.tenants)).toBe(true);

      const match = res.body.tenants.find((t: any) => t.tenant_id === ADMIN_TENANT);
      expect(match).toBeDefined();
      expect(match.company_description).toBe('E2E тест Owner Console');
      expect(match.market_type).toBe('B2C');
    },
    15_000,
  );
});
