import { z } from "zod";

export const ScoutChannelSchema = z.object({
  platform: z.string().min(1),
  identifier: z.string().min(1),
  added_manually: z.boolean().default(true),
});
export type ScoutChannel = z.infer<typeof ScoutChannelSchema>;

export const ScoutJobStatusEnum = z.enum(["running", "paused", "stopped"]);

export const ScoutJobStatsSchema = z.object({
  messages_scanned: z.number().default(0),
  signals_found: z.number().default(0),
  cards_created: z.number().default(0),
});

export const ScoutJobSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  status: ScoutJobStatusEnum.default("paused"),
  channels: z.array(ScoutChannelSchema).default([]),
  search_signals: z.array(z.string()).default([]),
  poll_interval_minutes: z.number().int().positive().default(60),
  created_at: z.string(),
  updated_at: z.string(),
  stats: ScoutJobStatsSchema.default({}),
});
export type ScoutJob = z.infer<typeof ScoutJobSchema>;

// ─── Payload schemas for ToolAction ──────────────────────────────────────────

export const CreateScoutJobPayloadSchema = z.object({
  tenant_id: z.string().min(1),
  search_signals: z.array(z.string()).default([]),
  poll_interval_minutes: z.number().int().positive().default(60),
});

export const AddScoutChannelPayloadSchema = z.object({
  tenant_id: z.string().min(1),
  scout_job_id: z.string().min(1),
  platform: z.string().min(1),
  identifier: z.string().min(1),
});

export const RemoveScoutChannelPayloadSchema = z.object({
  tenant_id: z.string().min(1),
  scout_job_id: z.string().min(1),
  platform: z.string().min(1),
  identifier: z.string().min(1),
});

export const UpdateScoutJobStatusPayloadSchema = z.object({
  tenant_id: z.string().min(1),
  scout_job_id: z.string().min(1),
  status: ScoutJobStatusEnum,
});
