-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "productHandle" TEXT,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "productTitle" TEXT,
ADD COLUMN     "productUrl" TEXT;

-- CreateTable
CREATE TABLE "ProductHashtag" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "hashtag" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductHashtag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductHashtag_shop_productId_idx" ON "ProductHashtag"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductHashtag_shop_productId_hashtag_key" ON "ProductHashtag"("shop", "productId", "hashtag");

