import { z } from "zod";

// Раздел 10, ТЗ v3.0 — Business Foundation. tenant_id обязателен в каждой схеме,
// это не опция: без него мультитенантность (раздел 9 ТЗ) невозможна архитектурно.
export const AssistantStageSchema = z.enum(["profile_setup", "daily_assistant"]);
export type AssistantStage = z.infer<typeof AssistantStageSchema>;

export const BusinessFoundationSchema = z.object({
  tenant_id: z.string().min(1),
  assistant_stage: AssistantStageSchema.default("profile_setup"),
  company_description: z.string().optional(),
  business_type: z.string().optional(),
  market_type: z.enum(["B2B", "B2C", "mixed"]).optional(),
  industry: z.string().optional(),
  segment: z.string().optional(),
  icp: z.string().optional(),
  buyer_type: z.string().optional(),
  offer: z.string().optional(),
  company_name: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  working_hours: z.string().optional(),
  geography: z.array(z.string()).optional(),
  scout_geography: z.array(z.string()).optional(),
  scout_targets: z.string().optional(),
  search_goal: z.string().optional(),
  website_url: z.string().url().optional(),
  product_summary: z.string().optional(),
  updated_at: z.string().datetime().optional(),
  updated_by: z.string().optional(),
});

export type BusinessFoundation = z.infer<typeof BusinessFoundationSchema>;

// Патч — все поля кроме tenant_id опциональны. tenant_id обязателен и здесь:
// патч без привязки к тенанту не проходит на уровень Validation Layer.
export const BusinessFoundationPatchSchema = BusinessFoundationSchema.partial().extend({
  tenant_id: z.string().min(1),
});
export type BusinessFoundationPatch = z.infer<typeof BusinessFoundationPatchSchema>;
