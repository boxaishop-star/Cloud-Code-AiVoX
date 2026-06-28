import type { ToolAction, ToolActionResult } from "./schemas/toolAction.js";
import type { ProductCard } from "./schemas/productCard.js";
import { ProductCardSchema } from "./schemas/productCard.js";
import type { BusinessFoundation } from "./schemas/businessFoundation.js";
import type { DataStore } from "./store.js";

// Раздел 9 ТЗ (мультитенантность): хранилище партиционировано по tenant_id на уровне
// структуры данных, а не "не забыли добавить WHERE" — на Этапе 1 та же гарантия
// обеспечивается слоем доступа к Postgres с автоматическим фильтром по tenant_id.
export class InMemoryStore implements DataStore {
  private foundations = new Map<string, BusinessFoundation>();
  private productCards = new Map<string, ProductCard[]>(); // key: tenant_id
  private relationshipCards = new Map<string, Record<string, unknown>[]>();

  getFoundation(tenantId: string): Promise<BusinessFoundation | undefined> {
    return Promise.resolve(this.foundations.get(tenantId));
  }
  getProductCards(tenantId: string): Promise<ProductCard[]> {
    return Promise.resolve(this.productCards.get(tenantId) ?? []);
  }
  getRelationshipCards(tenantId: string): Promise<Record<string, unknown>[]> {
    return Promise.resolve(this.relationshipCards.get(tenantId) ?? []);
  }

  applyAction(action: ToolAction): Promise<ToolActionResult> {
    try {
      switch (action.type) {
        case "upsert_business_foundation": {
          const tenantId = (action.payload as any).tenant_id as string;
          const prev = this.foundations.get(tenantId) ?? ({ tenant_id: tenantId } as BusinessFoundation);
          this.foundations.set(tenantId, { ...prev, ...action.payload, updated_at: new Date().toISOString() } as BusinessFoundation);
          return Promise.resolve({ action, applied: true });
        }
        case "upsert_product_card": {
          const tenantId = (action.payload as any).tenant_id as string;
          const serviceLine = (action.payload as any).service_line as string;
          const list = this.productCards.get(tenantId) ?? [];
          const idx = list.findIndex((c) => c.service_line === serviceLine);
          const merged = idx >= 0 ? { ...list[idx], ...action.payload } : action.payload;
          const normalized = ProductCardSchema.parse(merged) as ProductCard;
          if (idx >= 0) {
            list[idx] = normalized;
          } else {
            list.push(normalized);
          }
          this.productCards.set(tenantId, list);
          return Promise.resolve({ action: { ...action, payload: normalized }, applied: true });
        }
        case "update_product_card": {
          const tenantId = (action.payload as any).tenant_id as string;
          const serviceLine = (action.payload as any).service_line as string;
          const list = this.productCards.get(tenantId) ?? [];
          const idx = list.findIndex((c) => c.service_line === serviceLine);
          if (idx < 0) {
            return Promise.resolve({
              action,
              applied: false,
              error: `ProductCard not found for service_line '${serviceLine}' — use upsert_product_card to create it first`,
            });
          }
          const merged = { ...list[idx], ...action.payload };
          const normalized = ProductCardSchema.parse(merged) as ProductCard;
          list[idx] = normalized;
          this.productCards.set(tenantId, list);
          return Promise.resolve({ action: { ...action, payload: normalized }, applied: true });
        }
        case "create_relationship_card": {
          const tenantId = (action.payload as any).tenant_id as string;
          const list = this.relationshipCards.get(tenantId) ?? [];
          list.push(action.payload as Record<string, unknown>);
          this.relationshipCards.set(tenantId, list);
          return Promise.resolve({ action, applied: true });
        }
        default:
          // Прочие actions (create_scout_job, update_avi_profile, attach_material и т.д.)
          // на Этапе 0 не имеют целевого хранилища — реализуются по мере подключения
          // соответствующих сервисов (раздел 25 ТЗ, Этап 1-2).
          return Promise.resolve({ action, applied: false, error: `Action "${action.type}" не реализован на Этапе 0` });
      }
    } catch (e) {
      return Promise.resolve({ action, applied: false, error: String(e) });
    }
  }
}
