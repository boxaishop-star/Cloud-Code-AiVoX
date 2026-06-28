import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { getPrismaClient } from '@aivox/core';

// Текст про маникюр — простой сценарий для проверки полного пути от HTTP до БД.
const MANICURE_MESSAGE =
  'Хочу настроить услугу маникюр классический. Цена 1500 рублей за сеанс. ' +
  'Входит снятие старого покрытия, уход за кутикулой, покрытие гель-лаком. ' +
  'Клиенты — женщины 20-45 лет. Работаем в Москве.';

const TENANT_ID = 'test_api_manicure_' + Math.random().toString(36).slice(2, 8);

const canRun = !!process.env.ANTHROPIC_API_KEY && !!process.env.DATABASE_URL;

afterAll(async () => {
  if (!canRun) return;
  const client = getPrismaClient();
  await client.productCard.deleteMany({ where: { tenant_id: TENANT_ID } }).catch(() => {});
});

describe('POST /api/chat', () => {
  it('GET /health returns { status: "ok" }', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it.skipIf(!canRun)(
    'returns appliedActions with upsert_product_card applied: true for маникюр message',
    async () => {
      const res = await request(app)
        .post('/api/chat')
        .send({ userMessage: MANICURE_MESSAGE, tenant_id: TENANT_ID })
        .expect(200);

      expect(res.body.intent).toBeTruthy();
      const applied = (res.body.appliedActions as any[]).find(
        (a) => a.action.type === 'upsert_product_card',
      );
      expect(applied?.applied).toBe(true);
    },
    30000,
  );

  it('returns 400 when userMessage is missing', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ tenant_id: 'x' })
      .expect(400);
    expect(res.body.error).toBeTruthy();
  });
});
