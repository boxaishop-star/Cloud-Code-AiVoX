-- CreateTable
CREATE TABLE "business_foundations" (
    "tenant_id" TEXT NOT NULL,
    "company_description" TEXT,
    "business_type" TEXT,
    "market_type" TEXT,
    "industry" TEXT,
    "segment" TEXT,
    "icp" TEXT,
    "buyer_type" TEXT,
    "offer" TEXT,
    "geography" TEXT[],
    "scout_geography" TEXT[],
    "scout_targets" TEXT,
    "search_goal" TEXT,
    "website_url" TEXT,
    "product_summary" TEXT,
    "updated_at" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "business_foundations_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "product_cards" (
    "db_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "service_line" TEXT NOT NULL,
    "description" TEXT,
    "pricing_model" TEXT NOT NULL,
    "unit" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "price_rules" TEXT[],
    "includes" TEXT[],
    "excludes" TEXT[],
    "estimate_inputs" TEXT[],
    "variants" TEXT[],
    "customer_segments" TEXT[],
    "geography" TEXT[],
    "scout_search_signals" TEXT[],
    "scout_sources" TEXT[],
    "avi_qualification_questions" TEXT[],
    "handoff_to_human_rules" TEXT[],
    "readiness_score" INTEGER NOT NULL DEFAULT 0,
    "missing_fields" TEXT[],
    "evidence" JSONB[],
    "source" TEXT NOT NULL DEFAULT 'business_assistant',
    "created_from_conversation" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_cards_pkey" PRIMARY KEY ("db_id")
);

-- CreateTable
CREATE TABLE "relationship_cards" (
    "db_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "company_name" TEXT,
    "contact" TEXT,
    "channel" TEXT,
    "source" TEXT,
    "source_url" TEXT,
    "source_tier" TEXT NOT NULL,
    "legal_basis" TEXT NOT NULL,
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "market_type" TEXT,
    "segment" TEXT,
    "buyer_type" TEXT,
    "detected_need" TEXT,
    "matched_service_line" TEXT,
    "conversation_summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "next_step" TEXT,
    "confidence_score" DOUBLE PRECISION,
    "owner_agent" TEXT,
    "handoff_required" BOOLEAN NOT NULL DEFAULT false,
    "handoff_reason" TEXT,

    CONSTRAINT "relationship_cards_pkey" PRIMARY KEY ("db_id")
);

-- CreateIndex
CREATE INDEX "business_foundations_tenant_id_idx" ON "business_foundations"("tenant_id");

-- CreateIndex
CREATE INDEX "product_cards_tenant_id_idx" ON "product_cards"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_cards_tenant_id_service_line_key" ON "product_cards"("tenant_id", "service_line");

-- CreateIndex
CREATE INDEX "relationship_cards_tenant_id_idx" ON "relationship_cards"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "relationship_cards_tenant_id_id_key" ON "relationship_cards"("tenant_id", "id");
