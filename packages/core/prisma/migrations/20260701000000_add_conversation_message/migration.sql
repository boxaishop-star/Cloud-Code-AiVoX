-- AlterTable: add birthday to relationship_cards
ALTER TABLE "relationship_cards" ADD COLUMN "birthday" TEXT;

-- CreateTable: conversations
CREATE TABLE "conversations" (
    "db_id"                TEXT NOT NULL DEFAULT gen_random_uuid(),
    "id"                   TEXT NOT NULL,
    "tenant_id"            TEXT NOT NULL,
    "channel"              TEXT NOT NULL,
    "external_chat_id"     TEXT NOT NULL,
    "external_user_id"     TEXT NOT NULL,
    "relationship_card_id" TEXT,
    "product_card_id"      TEXT,
    "status"               TEXT NOT NULL DEFAULT 'active',
    "created_at"           TEXT NOT NULL,
    "updated_at"           TEXT NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("db_id")
);

CREATE UNIQUE INDEX "conversations_tenant_chat_channel_key"
    ON "conversations"("tenant_id", "external_chat_id", "channel");

CREATE INDEX "conversations_tenant_id_idx"
    ON "conversations"("tenant_id");

-- CreateTable: messages
CREATE TABLE "messages" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" TEXT NOT NULL,
    "tenant_id"       TEXT NOT NULL,
    "role"            TEXT NOT NULL,
    "text"            TEXT NOT NULL,
    "logged_facts"    JSONB NOT NULL DEFAULT '[]',
    "created_at"      TEXT NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");
CREATE INDEX "messages_tenant_id_idx"       ON "messages"("tenant_id");
