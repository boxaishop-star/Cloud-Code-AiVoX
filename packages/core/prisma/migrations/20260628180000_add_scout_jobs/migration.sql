-- CreateTable
CREATE TABLE "scout_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'paused',
    "channels" JSONB[] NOT NULL DEFAULT '{}',
    "search_signals" TEXT[] NOT NULL DEFAULT '{}',
    "poll_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "scout_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scout_jobs_tenant_id_idx" ON "scout_jobs"("tenant_id");
