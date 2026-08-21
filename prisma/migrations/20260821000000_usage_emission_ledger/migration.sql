-- Usage-based billing ledger for Shopify App Pricing App Events. Purely
-- additive: one new table, no existing table touched, so this is safe to run
-- against live production data.

-- CreateTable
CREATE TABLE "UsageEmission" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "eventHandle" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageEmission_idempotencyKey_key" ON "UsageEmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEmission_shop_idx" ON "UsageEmission"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEmission_shop_eventHandle_periodKey_key" ON "UsageEmission"("shop", "eventHandle", "periodKey");
