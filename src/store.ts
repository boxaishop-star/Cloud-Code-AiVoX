import type { ProductCard } from './schemas/productCard.js';
import type { BusinessFoundation } from './schemas/businessFoundation.js';
import type { ToolAction, ToolActionResult } from './schemas/toolAction.js';

export interface DataStore {
  getFoundation(tenantId: string): Promise<BusinessFoundation | undefined>;
  getProductCards(tenantId: string): Promise<ProductCard[]>;
  getRelationshipCards(tenantId: string): Promise<Record<string, unknown>[]>;
  applyAction(action: ToolAction): Promise<ToolActionResult>;
}
