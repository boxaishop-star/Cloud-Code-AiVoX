import { z } from "zod";

export const ConversationStatusEnum = z.enum(["active", "needs_human", "closed"]);

export const ConversationSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  channel: z.string(),
  external_chat_id: z.string(),
  external_user_id: z.string(),
  relationship_card_id: z.string().optional(),
  product_card_id: z.string().optional(),
  status: ConversationStatusEnum.default("active"),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationStatus = z.infer<typeof ConversationStatusEnum>;
