import { z } from "zod";
import { BusinessFoundationPatchSchema } from "./businessFoundation.js";
import { ProductCardPatchSchema } from "./productCard.js";

// Раздел 17, ТЗ v3.0. Каждый action — типизированная команда. LLM никогда не вызывает
// эти действия напрямую — она только предлагает их (proposed_actions), а применяет
// их Tool Layer после прохождения Validation (раздел 16, 19 ТЗ).
export const ToolActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upsert_business_foundation"), payload: BusinessFoundationPatchSchema }),
  z.object({ type: z.literal("upsert_product_card"), payload: ProductCardPatchSchema }),
  z.object({ type: z.literal("update_product_card"), payload: ProductCardPatchSchema }),
  z.object({ type: z.literal("create_relationship_card"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("update_relationship_card"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("create_scout_job"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("update_scout_settings"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("update_avi_profile"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("attach_material"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("parse_document"), payload: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("create_handoff"), payload: z.record(z.string(), z.unknown()) }),
]);

export type ToolAction = z.infer<typeof ToolActionSchema>;

export interface ToolActionResult {
  action: ToolAction;
  applied: boolean;
  error?: string;
}
