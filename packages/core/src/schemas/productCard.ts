import { z } from "zod";

// Раздел 11, ТЗ v3.0. Жёсткое правило "категория не может быть услугой"
// проверяется в Validation Layer (validation.ts), не здесь — схема описывает форму,
// а не бизнес-смысл значения.
export const PricingModelEnum = z.enum(["per_m3", "fixed", "from_price", "custom"]);

export const ProductCardSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  service_line: z.string().min(1),
  description: z.string().optional(),
  pricing_model: PricingModelEnum,
  unit: z.string().optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().default("RUB"),
  price_rules: z.array(z.string()).default([]),
  includes: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
  estimate_inputs: z.array(z.string()).default([]),
  variants: z.array(z.string()).default([]),
  customer_segments: z.array(z.string()).default([]),
  geography: z.array(z.string()).default([]),
  scout_search_signals: z.array(z.string()).default([]),
  scout_sources: z.array(z.string()).default([]),
  avi_qualification_questions: z.array(z.string()).default([]),
  handoff_to_human_rules: z.array(z.string()).default([]),
  evidence: z.array(z.record(z.string(), z.unknown())).default([]),
  source: z.string().default("business_assistant"),
  created_from_conversation: z.boolean().default(true),
});

export type ProductCard = z.infer<typeof ProductCardSchema>;

export const ProductCardPatchSchema = ProductCardSchema.partial().extend({
  tenant_id: z.string().min(1),
  service_line: z.string().min(1), // service_line — ключ для upsert, обязателен даже в патче
});
export type ProductCardPatch = z.infer<typeof ProductCardPatchSchema>;
