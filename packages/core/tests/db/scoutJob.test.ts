import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import { createPrismaClient } from '../../src/db/client.js';
import { PostgresStore } from '../../src/db/postgresStore.js';

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

const TENANT = 'test_scout_' + Math.random().toString(36).slice(2, 8);

describe('ScoutJob — PostgresStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let store: PostgresStore;
  let dbAvailable = false;
  let jobId: string;

  beforeAll(async () => {
    dbAvailable = await isDbAvailable();
    if (!dbAvailable) return;
    client = createPrismaClient();
    store = new PostgresStore(client);
  });

  afterAll(async () => {
    if (!dbAvailable || !client) return;
    await client.scoutJob.deleteMany({ where: { tenant_id: TENANT } }).catch(() => {});
    await client.$disconnect();
  });

  it('create_scout_job создаёт задачу в БД', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await store.applyAction({
      type: 'create_scout_job',
      payload: {
        tenant_id: TENANT,
        search_signals: ['ленточный фундамент', 'фундамент под дом'],
        poll_interval_minutes: 45,
      },
    });
    expect(res.applied).toBe(true);
    jobId = (res.action.payload as any).id as string;
    expect(jobId).toBeTruthy();

    const jobs = await store.getScoutJobs(TENANT);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe('paused');
    expect(jobs[0].channels).toHaveLength(0);
    expect(jobs[0].search_signals).toContain('ленточный фундамент');
  });

  it('add_scout_channel добавляет каналы двух платформ', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    await store.applyAction({
      type: 'add_scout_channel',
      payload: { tenant_id: TENANT, scout_job_id: jobId, platform: 'telegram', identifier: '@stroyforumru' },
    });
    const res = await store.applyAction({
      type: 'add_scout_channel',
      payload: { tenant_id: TENANT, scout_job_id: jobId, platform: 'vk', identifier: 'club_stroitelstvo' },
    });
    expect(res.applied).toBe(true);

    const jobs = await store.getScoutJobs(TENANT);
    expect(jobs[0].channels).toHaveLength(2);
    expect(jobs[0].channels.map((c) => c.platform)).toEqual(
      expect.arrayContaining(['telegram', 'vk']),
    );
  });

  it('add_scout_channel отклоняет дубль', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const dup = await store.applyAction({
      type: 'add_scout_channel',
      payload: { tenant_id: TENANT, scout_job_id: jobId, platform: 'vk', identifier: 'club_stroitelstvo' },
    });
    expect(dup.applied).toBe(false);
    expect(dup.error).toMatch(/already added/);
  });

  it('remove_scout_channel удаляет канал, остальные остаются', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await store.applyAction({
      type: 'remove_scout_channel',
      payload: { tenant_id: TENANT, scout_job_id: jobId, platform: 'telegram', identifier: '@stroyforumru' },
    });
    expect(res.applied).toBe(true);

    const jobs = await store.getScoutJobs(TENANT);
    expect(jobs[0].channels).toHaveLength(1);
    expect(jobs[0].channels[0].identifier).toBe('club_stroitelstvo');
  });

  it('update_scout_job_status меняет статус на running, затем stopped', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    await store.applyAction({
      type: 'update_scout_job_status',
      payload: { tenant_id: TENANT, scout_job_id: jobId, status: 'running' },
    });
    let jobs = await store.getScoutJobs(TENANT);
    expect(jobs[0].status).toBe('running');

    await store.applyAction({
      type: 'update_scout_job_status',
      payload: { tenant_id: TENANT, scout_job_id: jobId, status: 'stopped' },
    });
    jobs = await store.getScoutJobs(TENANT);
    expect(jobs[0].status).toBe('stopped');
  });

  it('update_scout_job_status на несуществующий job возвращает ошибку', async (ctx) => {
    if (!dbAvailable) return ctx.skip();

    const res = await store.applyAction({
      type: 'update_scout_job_status',
      payload: { tenant_id: TENANT, scout_job_id: 'no-such-id', status: 'running' },
    });
    expect(res.applied).toBe(false);
    expect(res.error).toMatch(/not found/);
  });
}, 30_000);
