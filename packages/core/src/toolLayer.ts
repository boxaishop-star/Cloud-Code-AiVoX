import { randomUUID } from "crypto";
import type { ToolAction, ToolActionResult } from "./schemas/toolAction.js";
import type { ProductCard } from "./schemas/productCard.js";
import { ProductCardSchema } from "./schemas/productCard.js";
import type { BusinessFoundation } from "./schemas/businessFoundation.js";
import type { ScoutJob } from "./schemas/scoutJob.js";
import { ScoutJobSchema, ScoutChannelSchema } from "./schemas/scoutJob.js";
import type { DataStore } from "./store.js";

// Раздел 9 ТЗ (мультитенантность): хранилище партиционировано по tenant_id на уровне
// структуры данных, а не "не забыли добавить WHERE" — на Этапе 1 та же гарантия
// обеспечивается слоем доступа к Postgres с автоматическим фильтром по tenant_id.
export class InMemoryStore implements DataStore {
  private foundations = new Map<string, BusinessFoundation>();
  private productCards = new Map<string, ProductCard[]>(); // key: tenant_id
  private relationshipCards = new Map<string, Record<string, unknown>[]>();
  private scoutJobs = new Map<string, ScoutJob>();          // key: job id

  getFoundation(tenantId: string): Promise<BusinessFoundation | undefined> {
    return Promise.resolve(this.foundations.get(tenantId));
  }
  getProductCards(tenantId: string): Promise<ProductCard[]> {
    return Promise.resolve(this.productCards.get(tenantId) ?? []);
  }
  getRelationshipCards(tenantId: string): Promise<Record<string, unknown>[]> {
    return Promise.resolve(this.relationshipCards.get(tenantId) ?? []);
  }
  getScoutJobs(tenantId: string): Promise<ScoutJob[]> {
    const jobs = [...this.scoutJobs.values()].filter((j) => j.tenant_id === tenantId);
    return Promise.resolve(jobs);
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
        case "create_scout_job": {
          const now = new Date().toISOString();
          const job = ScoutJobSchema.parse({
            id: randomUUID(),
            tenant_id: action.payload.tenant_id,
            search_signals: action.payload.search_signals ?? [],
            poll_interval_minutes: action.payload.poll_interval_minutes ?? 60,
            channels: [],
            created_at: now,
            updated_at: now,
          });
          this.scoutJobs.set(job.id, job);
          return Promise.resolve({ action: { ...action, payload: job as any }, applied: true });
        }
        case "add_scout_channel": {
          const { tenant_id, scout_job_id, platform, identifier } = action.payload;
          const job = this.scoutJobs.get(scout_job_id);
          if (!job || job.tenant_id !== tenant_id) {
            return Promise.resolve({ action, applied: false, error: `ScoutJob '${scout_job_id}' not found` });
          }
          const exists = job.channels.some((c) => c.platform === platform && c.identifier === identifier);
          if (exists) {
            return Promise.resolve({ action, applied: false, error: `Channel ${platform}:${identifier} already added` });
          }
          const channel = ScoutChannelSchema.parse({ platform, identifier, added_manually: true });
          const updated = { ...job, channels: [...job.channels, channel], updated_at: new Date().toISOString() };
          this.scoutJobs.set(scout_job_id, updated);
          return Promise.resolve({ action: { ...action, payload: updated as any }, applied: true });
        }
        case "remove_scout_channel": {
          const { tenant_id, scout_job_id, platform, identifier } = action.payload;
          const job = this.scoutJobs.get(scout_job_id);
          if (!job || job.tenant_id !== tenant_id) {
            return Promise.resolve({ action, applied: false, error: `ScoutJob '${scout_job_id}' not found` });
          }
          const before = job.channels.length;
          const channels = job.channels.filter((c) => !(c.platform === platform && c.identifier === identifier));
          if (channels.length === before) {
            return Promise.resolve({ action, applied: false, error: `Channel ${platform}:${identifier} not found in job` });
          }
          const updated = { ...job, channels, updated_at: new Date().toISOString() };
          this.scoutJobs.set(scout_job_id, updated);
          return Promise.resolve({ action: { ...action, payload: updated as any }, applied: true });
        }
        case "update_scout_job_status": {
          const { tenant_id, scout_job_id, status } = action.payload;
          const job = this.scoutJobs.get(scout_job_id);
          if (!job || job.tenant_id !== tenant_id) {
            return Promise.resolve({ action, applied: false, error: `ScoutJob '${scout_job_id}' not found` });
          }
          const updated = { ...job, status, updated_at: new Date().toISOString() };
          this.scoutJobs.set(scout_job_id, updated);
          return Promise.resolve({ action: { ...action, payload: updated as any }, applied: true });
        }
        default:
          return Promise.resolve({ action, applied: false, error: `Action "${(action as any).type}" не реализован` });
      }
    } catch (e) {
      return Promise.resolve({ action, applied: false, error: String(e) });
    }
  }
}
