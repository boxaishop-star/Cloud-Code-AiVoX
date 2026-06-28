import type { ProductCard } from './schemas/productCard.js';
import type { BusinessFoundation } from './schemas/businessFoundation.js';
import type { ToolAction, ToolActionResult } from './schemas/toolAction.js';

export interface DataStore {
  getFoundation(tenantId: string): Promise<BusinessFoundation | undefined>;
  getProductCards(tenantId: string): Promise<ProductCard[]>;
  getRelationshipCards(tenantId: string): Promise<Record<string, unknown>[]>;
  applyAction(action: ToolAction): Promise<ToolActionResult>;
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
