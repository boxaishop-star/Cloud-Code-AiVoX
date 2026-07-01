import { randomUUID } from "crypto";
import type { ToolAction, ToolActionResult } from "./schemas/toolAction.js";
import type { ProductCard } from "./schemas/productCard.js";
import { ProductCardSchema } from "./schemas/productCard.js";
import type { BusinessFoundation } from "./schemas/businessFoundation.js";
import type { ScoutJob } from "./schemas/scoutJob.js";
import { ScoutJobSchema, ScoutChannelSchema } from "./schemas/scoutJob.js";
import type { Conversation } from "./schemas/conversation.js";
import type { Message } from "./schemas/message.js";
import type { DataStore, AdminDataStore } from "./store.js";

// Список array-полей ProductCard, защищённых от тихой перезаписи пустым массивом при update.
// Явная очистка поля должна быть отдельным явным флагом, не побочным эффектом пустого массива.
const PROTECTED_ARRAY_FIELDS = [
  'includes', 'excludes', 'estimate_inputs', 'customer_segments',
  'geography', 'scout_search_signals', 'scout_sources',
  'avi_qualification_questions', 'handoff_to_human_rules',
  'price_rules', 'variants',
] as const;

// Раздел 9 ТЗ (мультитенантность): хранилище партиционировано по tenant_id на уровне
// структуры данных, а не "не забыли добавить WHERE" — на Этапе 1 та же гарантия
// обеспечивается слоем доступа к Postgres с автоматическим фильтром по tenant_id.
export class InMemoryStore implements AdminDataStore {
  private foundations = new Map<string, BusinessFoundation>();
  private productCards = new Map<string, ProductCard[]>(); // key: tenant_id
  private relationshipCards = new Map<string, Record<string, unknown>[]>();
  private scoutJobs = new Map<string, ScoutJob>();          // key: job id
  private conversations = new Map<string, Conversation>();  // key: `${tenantId}:${channel}:${externalChatId}`
  private messages = new Map<string, Message[]>();          // key: conversation_id

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
  // AdminDataStore — раздел 9.1 ТЗ. Источник: уникальные tenant_id из foundations.
  getAllTenants(): Promise<string[]> {
    return Promise.resolve([...this.foundations.keys()]);
  }

  // ── Conversation ──────────────────────────────────────────────────────────────

  findConversation(tenantId: string, channel: string, externalChatId: string): Promise<Conversation | undefined> {
    return Promise.resolve(this.conversations.get(`${tenantId}:${channel}:${externalChatId}`));
  }
  saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(`${conversation.tenant_id}:${conversation.channel}:${conversation.external_chat_id}`, conversation);
    return Promise.resolve();
  }

  // ── Message ───────────────────────────────────────────────────────────────────

  getMessages(conversationId: string): Promise<Message[]> {
    return Promise.resolve(this.messages.get(conversationId) ?? []);
  }
  saveMessage(message: Message): Promise<void> {
    const list = this.messages.get(message.conversation_id) ?? [];
    list.push(message);
    this.messages.set(message.conversation_id, list);
    return Promise.resolve();
  }

  // ── RelationshipCard targeted ops ─────────────────────────────────────────────

  getRelationshipCardById(tenantId: string, id: string): Promise<Record<string, unknown> | undefined> {
    const list = this.relationshipCards.get(tenantId) ?? [];
    return Promise.resolve(list.find((c) => c.id === id));
  }
  updateRelationshipCard(tenantId: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const list = this.relationshipCards.get(tenantId) ?? [];
    const idx = list.findIndex((c) => c.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      this.relationshipCards.set(tenantId, list);
    }
    return Promise.resolve();
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
          // Защита от потери данных: пустой массив в payload не перезаписывает уже
          // собранные данные в существующей карточке. Явная очистка — отдельный флаг.
          const safePayload = { ...action.payload } as Record<string, unknown>;
          for (const field of PROTECTED_ARRAY_FIELDS) {
            const incoming = safePayload[field];
            const existing = (list[idx] as Record<string, unknown>)[field];
            if (Array.isArray(incoming) && incoming.length === 0 &&
                Array.isArray(existing) && existing.length > 0) {
              delete safePayload[field];
            }
          }
          const merged = { ...list[idx], ...safePayload };
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
        case "update_relationship_card": {
          const p = action.payload as Record<string, unknown>;
          const tenantId = p.tenant_id as string;
          const id = p.id as string;
          const { tenant_id: _t, id: _i, ...patch } = p;
          const list = this.relationshipCards.get(tenantId) ?? [];
          const idx = list.findIndex((c) => c.id === id);
          if (idx >= 0) {
            list[idx] = { ...list[idx], ...patch };
            this.relationshipCards.set(tenantId, list);
          }
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
