-- Shopify App Pricing billing rework. Purely additive: three new tables plus one
-- nullable column on ShopSettings. No existing table is dropped or rewritten, so
-- this is safe to run against live production data.

-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "onboardingDismissedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShopBilling" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopGid" TEXT,
    "planHandle" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'none',
    "tierSource" TEXT NOT NULL DEFAULT 'none',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncOk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTierMapping" (
    "id" TEXT NOT NULL,
    "planHandle" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTierMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalBanner" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'info',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopBilling_shop_key" ON "ShopBilling"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTierMapping_planHandle_key" ON "PlanTierMapping"("planHandle");
