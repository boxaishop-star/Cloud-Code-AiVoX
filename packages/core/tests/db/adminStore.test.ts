import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { createPrismaClient } from '../../src/db/client.js';
import { PostgresStore } from '../../src/db/postgresStore.js';
import type { AdminDataStore } from '../../src/store.js';

const DATABASE_URL = process.env.DATABASE_URL;

async function isDbAvailable(): Promise<boolean> {
  if (!DATABASE_URL) return false;
  let client: ReturnType<typeof createPrismaClient> | undefined;
  try {
    client = createPrismaClient();
    // @ts-ignore
    await client.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    // @ts-ignore
    await client?.$disconnect().catch(() => {});
  }
}

const PREFIX = 'test_admin_' + Math.random().toString(36).slice(2, 8);
const TENANTS = [`${PREFIX}_A`, `${PREFIX}_B`, `${PREFIX}_C`];

describe('getAllTenants — PostgresStore (раздел 9.1 ТЗ)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let store: PostgresStore;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) return;
    client = createPrismaClient();
    store = new PostgresStore(client);
    for (const tid of TENANTS) {
      await store.applyAction({
        type: 'upsert_business_foundation',
        payload: { tenant_id: tid, company_description: `Компания ${tid}` },
      });
    }
  });

  afterAll(async () => {
    if (!dbAvailable || !client) return;
    await client.businessFoundation.deleteMany({
      where: { tenant_id: { in: TENANTS } },
    }).catch(() => {});
    await client.$disconnect();
  });

  it('возвращает все созданные tenant_id', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const admin = store as unknown as AdminDataStore;
    const tenants = await admin.getAllTenants();

    for (const tid of TENANTS) {
      expect(tenants).toContain(tid);
    }
  });

  it('не возвращает дублей (repeated upsert)', async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const dupTenant = `${PREFIX}_dup`;
    await store.applyAction({
      type: 'upsert_business_foundation',
      payload: { tenant_id: dupTenant, company_description: 'v1' },
    });
    await store.applyAction({
      type: 'upsert_business_foundation',
      payload: { tenant_id: dupTenant, company_description: 'v2' },
    });

    const admin = store as unknown as AdminDataStore;
    const tenants = await admin.getAllTenants();
    const count = tenants.filter((t) => t === dupTenant).length;
    expect(count).toBe(1);

    await client.businessFoundation.deleteMany({ where: { tenant_id: dupTenant } }).catch(() => {});
  });
}, 30_000);
