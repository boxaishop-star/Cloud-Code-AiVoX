// PostgresStore — альтернативная реализация того же контракта, что InMemoryStore.
import { randomUUID } from 'crypto';
import { ProductCardSchema } from '../schemas/productCard.js';
import { BusinessFoundationSchema } from '../schemas/businessFoundation.js';
import { ScoutJobSchema, ScoutChannelSchema } from '../schemas/scoutJob.js';
import type { ProductCard } from '../schemas/productCard.js';
import type { BusinessFoundation } from '../schemas/businessFoundation.js';
import type { ScoutJob } from '../schemas/scoutJob.js';
import type { ToolAction, ToolActionResult } from '../schemas/toolAction.js';
import type { DataStore, AdminDataStore } from '../store.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrismaClient = any;

/** Удаляет null-значения из объекта: Prisma возвращает null, Zod ожидает undefined. */
function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));
}

/** Конвертирует строку Prisma ProductCard в объект, пригодный для ProductCardSchema.parse(). */
function fromPrismaCard(row: Record<string, unknown>): Record<string, unknown> {
  const { db_id: _, ...rest } = row;
  return stripNulls({ ...rest, evidence: (rest.evidence as unknown[]) ?? [] });
}

/** Конвертирует строку Prisma ScoutJob, нормализуя Json[] и Json поля. */
function fromPrismaJob(row: Record<string, unknown>): Record<string, unknown> {
  return stripNulls({
    ...row,
    channels: (row.channels as unknown[]) ?? [],
    stats: (row.stats as Record<string, unknown>) ?? {},
  });
}

export class PostgresStore implements AdminDataStore {
  constructor(private client: AnyPrismaClient) {}

  // ──────────────── Read methods ────────────────

  async getFoundation(tenantId: string): Promise<BusinessFoundation | undefined> {
    const row = await this.client.businessFoundation.findUnique({
      where: { tenant_id: tenantId },
    });
    if (!row) return undefined;
    return BusinessFoundationSchema.parse(stripNulls(row));
  }

  async getProductCards(tenantId: string): Promise<ProductCard[]> {
    const rows: Record<string, unknown>[] = await this.client.productCard.findMany({
      where: { tenant_id: tenantId },
    });
    return rows.map((row) => ProductCardSchema.parse(fromPrismaCard(row)));
  }

  async getRelationshipCards(tenantId: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = await this.client.relationshipCard.findMany({
      where: { tenant_id: tenantId },
    });
    return rows.map((row) => {
      const { db_id: _, ...rest } = row;
      return stripNulls(rest);
    });
  }

  // AdminDataStore — раздел 9.1 ТЗ. Distinct по PK — без выгрузки строк в память.
  async getAllTenants(): Promise<string[]> {
    const rows: { tenant_id: string }[] = await this.client.businessFoundation.findMany({
      select: { tenant_id: true },
      distinct: ['tenant_id'],
    });
    return rows.map((r) => r.tenant_id);
  }

  async getScoutJobs(tenantId: string): Promise<ScoutJob[]> {
    const rows: Record<string, unknown>[] = await this.client.scoutJob.findMany({
      where: { tenant_id: tenantId },
    });
    return rows.map((row) => ScoutJobSchema.parse(fromPrismaJob(row)));
  }

  // ──────────────── Write (applyAction) ────────────────

  async applyAction(action: ToolAction): Promise<ToolActionResult> {
    try {
      switch (action.type) {
        case 'upsert_business_foundation': {
          const p = action.payload as Record<string, unknown>;
          const tenantId = p.tenant_id as string;
          await this.client.businessFoundation.upsert({
            where: { tenant_id: tenantId },
            create: { ...p, updated_at: new Date().toISOString() },
            update: { ...p, updated_at: new Date().toISOString() },
          });
          return { action, applied: true };
        }

        case 'upsert_product_card': {
          const p = action.payload as Record<string, unknown>;
          const tenantId = p.tenant_id as string;
          const serviceLine = p.service_line as string;
          const existing: Record<string, unknown> | null =
            await this.client.productCard.findFirst({
              where: { tenant_id: tenantId, service_line: serviceLine },
            });
          const base = existing ? fromPrismaCard(existing) : {};
          const normalized = ProductCardSchema.parse({ ...base, ...p });
          await this.client.productCard.upsert({
            where: { tenant_service_line: { tenant_id: tenantId, service_line: serviceLine } },
            create: normalized,
            update: normalized,
          });
          return { action: { ...action, payload: normalized }, applied: true };
        }

        case 'update_product_card': {
          const p = action.payload as Record<string, unknown>;
          const tenantId = p.tenant_id as string;
          const serviceLine = p.service_line as string;
          const existing: Record<string, unknown> | null =
            await this.client.productCard.findFirst({
              where: { tenant_id: tenantId, service_line: serviceLine },
            });
          if (!existing) {
            return {
              action,
              applied: false,
              error: `ProductCard not found for service_line '${serviceLine}' — use upsert_product_card to create it first`,
            };
          }
          const normalized = ProductCardSchema.parse({ ...fromPrismaCard(existing), ...p });
          await this.client.productCard.update({
            where: { tenant_service_line: { tenant_id: tenantId, service_line: serviceLine } },
            data: normalized,
          });
          return { action: { ...action, payload: normalized }, applied: true };
        }

        case 'create_relationship_card': {
          const p = action.payload as Record<string, unknown>;
          await this.client.relationshipCard.create({ data: p });
          return { action, applied: true };
        }

        case 'create_scout_job': {
          const { tenant_id, search_signals, poll_interval_minutes } = action.payload;
          const now = new Date().toISOString();
          const data = {
            id: randomUUID(),
            tenant_id,
            search_signals: search_signals ?? [],
            poll_interval_minutes: poll_interval_minutes ?? 60,
            channels: [],
            created_at: now,
            updated_at: now,
            stats: {},
          };
          await this.client.scoutJob.create({ data });
          const job = ScoutJobSchema.parse(data);
          return { action: { ...action, payload: job as any }, applied: true };
        }

        case 'add_scout_channel': {
          const { tenant_id, scout_job_id, platform, identifier } = action.payload;
          const row: Record<string, unknown> | null = await this.client.scoutJob.findFirst({
            where: { id: scout_job_id, tenant_id },
          });
          if (!row) {
            return { action, applied: false, error: `ScoutJob '${scout_job_id}' not found` };
          }
          const channels = (row.channels as any[]) ?? [];
          const exists = channels.some((c: any) => c.platform === platform && c.identifier === identifier);
          if (exists) {
            return { action, applied: false, error: `Channel ${platform}:${identifier} already added` };
          }
          const newChannel = ScoutChannelSchema.parse({ platform, identifier, added_manually: true });
          const updatedChannels = [...channels, newChannel];
          await this.client.scoutJob.update({
            where: { id: scout_job_id },
            data: { channels: updatedChannels, updated_at: new Date().toISOString() },
          });
          const job = ScoutJobSchema.parse(fromPrismaJob({ ...row, channels: updatedChannels }));
          return { action: { ...action, payload: job as any }, applied: true };
        }

        case 'remove_scout_channel': {
          const { tenant_id, scout_job_id, platform, identifier } = action.payload;
          const row: Record<string, unknown> | null = await this.client.scoutJob.findFirst({
            where: { id: scout_job_id, tenant_id },
          });
          if (!row) {
            return { action, applied: false, error: `ScoutJob '${scout_job_id}' not found` };
          }
          const channels = (row.channels as any[]) ?? [];
          const filtered = channels.filter((c: any) => !(c.platform === platform && c.identifier === identifier));
          if (filtered.length === channels.length) {
            return { action, applied: false, error: `Channel ${platform}:${identifier} not found in job` };
          }
          await this.client.scoutJob.update({
            where: { id: scout_job_id },
            data: { channels: filtered, updated_at: new Date().toISOString() },
          });
          const job = ScoutJobSchema.parse(fromPrismaJob({ ...row, channels: filtered }));
          return { action: { ...action, payload: job as any }, applied: true };
        }

        case 'update_scout_job_status': {
          const { tenant_id, scout_job_id, status } = action.payload;
          const row: Record<string, unknown> | null = await this.client.scoutJob.findFirst({
            where: { id: scout_job_id, tenant_id },
          });
          if (!row) {
            return { action, applied: false, error: `ScoutJob '${scout_job_id}' not found` };
          }
          await this.client.scoutJob.update({
            where: { id: scout_job_id },
            data: { status, updated_at: new Date().toISOString() },
          });
          const job = ScoutJobSchema.parse(fromPrismaJob({ ...row, status }));
          return { action: { ...action, payload: job as any }, applied: true };
        }

        default:
          return {
            action,
            applied: false,
            error: `Action "${(action as any).type}" не реализован`,
          };
      }
    } catch (e) {
      return { action, applied: false, error: String(e) };
    }
  }
}
