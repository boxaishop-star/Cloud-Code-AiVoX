import { z } from "zod";

export const MessageRoleEnum = z.enum(["client", "avi"]);

export const LoggedFactSchema = z.object({
  field: z.string(),
  value: z.string(),
  productCardVersion: z.string(),
});

export const MessageSchema = z.object({
  id: z.string().min(1),
  conversation_id: z.string().min(1),
  tenant_id: z.string().min(1),
  role: MessageRoleEnum,
  text: z.string(),
  logged_facts: z.array(LoggedFactSchema).default([]),
  created_at: z.string(),
});

export type Message = z.infer<typeof MessageSchema>;
export type MessageRole = z.infer<typeof MessageRoleEnum>;
