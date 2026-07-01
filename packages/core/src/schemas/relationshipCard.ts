import { z } from "zod";

// Раздел 12, ТЗ v3.0. legal_basis и source_tier обязательны для записей, созданных Scout —
// это не "желательно заполнить", а условие прохождения Validation Layer (раздел 19 ТЗ).
export const SourceTierEnum = z.enum(["tier1", "tier2", "manual"]);
export const RelationshipStatusEnum = z.enum([
  "new", "pending_review", "qualified", "needs_human", "proposal_needed", "won", "lost",
]);

export const RelationshipCardSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  type: z.enum(["lead", "customer", "company", "contact"]),
  name: z.string().optional(),
  company_name: z.string().optional(),
  contact: z.string().optional(),
  channel: z.string().optional(),
  source: z.string().optional(),
  source_url: z.string().optional(),
  source_tier: SourceTierEnum,
  legal_basis: z.string().min(1), // обязателен — раздел 7.3.2 ТЗ
  do_not_contact: z.boolean().default(false),
  location: z.string().optional(),
  market_type: z.enum(["B2B", "B2C"]).optional(),
  segment: z.string().optional(),
  buyer_type: z.string().optional(),
  detected_need: z.string().optional(),
  matched_service_line: z.string().optional(),
  conversation_summary: z.string().optional(),
  status: RelationshipStatusEnum.default("new"),
  next_step: z.string().optional(),
  confidence_score: z.number().min(0).max(1).nullable().default(null),
  owner_agent: z.enum(["scout", "avi", "human"]).optional(),
  handoff_required: z.boolean().default(false),
  handoff_reason: z.string().optional(),
  birthday: z.string().optional(),
}).refine(
  (card) => !(card.source_tier === "tier2" && card.status === "new"),
  { message: "Tier 2 источник не может иметь статус 'new' — обязателен 'pending_review' до подтверждения человеком (раздел 7.3.1 ТЗ)" }
);

export type RelationshipCard = z.infer<typeof RelationshipCardSchema>;
