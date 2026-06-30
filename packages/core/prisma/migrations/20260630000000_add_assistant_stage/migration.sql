-- AlterTable: add assistant_stage to business_foundations (раздел 7.1.1 ТЗ v9.0)
-- Existing rows default to 'profile_setup' — no data migration needed.
ALTER TABLE "business_foundations" ADD COLUMN "assistant_stage" TEXT NOT NULL DEFAULT 'profile_setup';
