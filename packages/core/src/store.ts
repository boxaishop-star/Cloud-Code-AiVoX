import type { ProductCard } from './schemas/productCard.js';
import type { BusinessFoundation } from './schemas/businessFoundation.js';
import type { ScoutJob } from './schemas/scoutJob.js';
import type { ToolAction, ToolActionResult } from './schemas/toolAction.js';
import type { Conversation } from './schemas/conversation.js';
import type { Message } from './schemas/message.js';

export interface DataStore {
  getFoundation(tenantId: string): Promise<BusinessFoundation | undefined>;
  getProductCards(tenantId: string): Promise<ProductCard[]>;
  getRelationshipCards(tenantId: string): Promise<Record<string, unknown>[]>;
  getScoutJobs(tenantId: string): Promise<ScoutJob[]>;
  applyAction(action: ToolAction): Promise<ToolActionResult>;

  // Conversation — раздел 7.2, 9, 12 ТЗ v9.1
  findConversation(tenantId: string, channel: string, externalChatId: string): Promise<Conversation | undefined>;
  saveConversation(conversation: Conversation): Promise<void>;

  // Message — хранение диалога Avi
  getMessages(conversationId: string): Promise<Message[]>;
  saveMessage(message: Message): Promise<void>;

  // RelationshipCard — обновление через прямой patch
  getRelationshipCardById(tenantId: string, id: string): Promise<Record<string, unknown> | undefined>;
  updateRelationshipCard(tenantId: string, id: string, patch: Record<string, unknown>): Promise<void>;
}

/**
 * Расширенный интерфейс для platform_owner — единственной роли, которой разрешён
 * обход фильтра по tenant_id (раздел 9.1 ТЗ).
 *
 * ВАЖНО: этот интерфейс НЕ входит в DataStore специально — доступ к нему требует
 * явного приведения типа с предшествующей проверкой роли platform_owner на стороне
 * вызывающего кода. Не добавляй getAllTenants() в DataStore.
 *
 * TODO (раздел 19 ТЗ, аудит): любой вызов getAllTenants() ОБЯЗАН логироваться
 * в audit-лог с указанием кто, когда и зачем запросил список тенантов.
 * Реализацию самого логирования отложить до подключения audit-сервиса.
 */
export interface AdminDataStore extends DataStore {
  getAllTenants(): Promise<string[]>;
}
