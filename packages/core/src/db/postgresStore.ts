// PostgresStore — альтернативная реализация того же контракта, что InMemoryStore.
// Методы асинхронны (Prisma требует await), поэтому PostgresStore нельзя передать в
// BusinessAssistantOrchestrator напрямую без адаптации его store-вызовов к async.
// На Этапе 1 Orchestrator будет доработан под async-интерфейс.
import { ProductCardSchema } from '../schemas/productCard.js';
import { BusinessFoundationSchema } from '../schemas/businessFoundation.js';
import type { ProductCard } from '../schemas/productCard.js';
import type { BusinessFoundation } from '../schemas/businessFoundation.js';
import type { ToolAction, ToolActionResult } from '../schemas/toolAction.js';
import type { DataStore } from '../store.js';

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

export class PostgresStore implements DataStore {
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

          // Merge with existing card to respect partial updates
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

        case 'create_relationship_card': {
          const p = action.payload as Record<string, unknown>;
          await this.client.relationshipCard.create({ data: p });
          return { action, applied: true };
        }

        default:
          return {
            action,
            applied: false,
            error: `Action "${action.type}" не реализован на Этапе 0`,
          };
      }
    } catch (e) {
      return { action, applied: false, error: String(e) };
    }
  }
}
