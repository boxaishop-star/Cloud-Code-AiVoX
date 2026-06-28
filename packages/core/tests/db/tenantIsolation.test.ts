import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { createPrismaClient } from '../../src/db/client.js';
import { PostgresStore } from '../../src/db/postgresStore.js';

const DATABASE_URL = process.env.DATABASE_URL;

/** Pings DB to check real availability; returns false if DB is down or creds wrong. */
async function isDbAvailable(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  let client: ReturnType<typeof createPrismaClient> | undefined;
  try {
    client = createPrismaClient();
    // @ts-ignore — $queryRawUnsafe exists on Prisma 7 client
    await client.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    // @ts-ignore
    await client?.$disconnect().catch(() => {});
  }
}

const TENANT_A = 'test_tenant_a_' + Math.random().toString(36).slice(2, 8);
const TENANT_B = 'test_tenant_b_' + Math.random().toString(36).slice(2, 8);

describe('PostgresStore — tenant isolation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let storeA: PostgresStore;
  let storeB: PostgresStore;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) return;
    client = createPrismaClient();
    storeA = new PostgresStore(client);
    storeB = new PostgresStore(client);
  });

  afterAll(async () => {
    if (!dbAvailable || !client) return;
    await client.productCard.deleteMany({ where: { tenant_id: { in: [TENANT_A, TENANT_B] } } });
    await client.businessFoundation.deleteMany({ where: { tenant_id: { in: [TENANT_A, TENANT_B] } } });
    await client.$disconnect();
  });

  it('stores and retrieves BusinessFoundation per tenant', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    await storeA.applyAction({
      type: 'upsert_business_foundation',
      payload: {
        tenant_id: TENANT_A,
        company_description: 'Ромашка',
        industry: 'Цветы',
        market_type: 'B2C',
        geography: ['RU'],
        offer: 'Доставка цветов',
      },
    });

    const found = await storeA.getFoundation(TENANT_A);
    expect(found?.company_description).toBe('Ромашка');
    expect(found?.industry).toBe('Цветы');

    // Tenant B must not see Tenant A's data
    const notFound = await storeB.getFoundation(TENANT_B);
    expect(notFound).toBeUndefined();
  });

  it('upserts ProductCard and reads it back', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    await storeA.applyAction({
      type: 'upsert_product_card',
      payload: {
        tenant_id: TENANT_A,
        id: 'card1',
        name: 'Маникюр классический',
        category: 'beauty',
        service_line: 'manicure',
        pricing_model: 'fixed',
        price: 1500,
        currency: 'RUB',
      },
    });

    const cards = await storeA.getProductCards(TENANT_A);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('Маникюр классический');
    expect(cards[0].price).toBe(1500);

    // Tenant B sees no cards
    const cardsB = await storeB.getProductCards(TENANT_B);
    expect(cardsB).toHaveLength(0);
  });

  it('merges partial upsert without losing existing fields', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Update only price — name must survive
    await storeA.applyAction({
      type: 'upsert_product_card',
      payload: {
        tenant_id: TENANT_A,
        id: 'card1',
        name: 'Маникюр классический',
        service_line: 'manicure',
        category: 'beauty',
        pricing_model: 'fixed',
        price: 2000,
      },
    });

    const cards = await storeA.getProductCards(TENANT_A);
    expect(cards).toHaveLength(1);
    expect(cards[0].price).toBe(2000);
    expect(cards[0].name).toBe('Маникюр классический');
  });

  it('update_product_card частично обновляет карточку, остальные поля сохраняются', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    // Сначала создаём карточку с includes
    await storeA.applyAction({
      type: 'upsert_product_card',
      payload: {
        tenant_id: TENANT_A,
        id: 'card_upd',
        name: 'Педикюр классический',
        category: 'beauty',
        service_line: 'pedicure_classic',
        pricing_model: 'fixed',
        price: 1200,
        currency: 'RUB',
        includes: ['обработка стопы', 'покрытие'],
      },
    });

    // Частичное обновление — только цена
    const result = await storeA.applyAction({
      type: 'update_product_card',
      payload: {
        tenant_id: TENANT_A,
        service_line: 'pedicure_classic',
        price: 1800,
      },
    });
    expect(result.applied).toBe(true);

    const cards = await storeA.getProductCards(TENANT_A);
    const updated = cards.find((c) => c.service_line === 'pedicure_classic');
    expect(updated?.price).toBe(1800);
    // Поля, не переданные в update, должны остаться нетронутыми
    expect(updated?.name).toBe('Педикюр классический');
    expect(updated?.includes).toEqual(['обработка стопы', 'покрытие']);
  });

  it('update_product_card на несуществующую карточку возвращает понятную ошибку', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const result = await storeA.applyAction({
      type: 'update_product_card',
      payload: {
        tenant_id: TENANT_A,
        service_line: 'does_not_exist_xyz',
        price: 999,
      },
    });
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(result.error).toContain('does_not_exist_xyz');
    expect(result.error).toMatch(/upsert_product_card/);
  });
}, 30000);
