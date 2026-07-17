-- Refactor from brand-owned OAuthToken to shop-level SocialAccount shared across
-- brands via the BrandSocialAccount join table. This migration is data-preserving:
-- it creates the new structures, copies existing OAuthToken rows into
-- SocialAccount, links each token's brand, backfills PostPlatform.socialAccountId,
-- and only then drops OAuthToken. Prisma runs the whole file in one transaction,
-- so any failure rolls back and leaves the live data untouched.

-- 1. New tables ---------------------------------------------------------------

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenSecret" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandSocialAccount" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,

    CONSTRAINT "BrandSocialAccount_pkey" PRIMARY KEY ("id")
);

-- 2. New PostPlatform column --------------------------------------------------

-- AlterTable
ALTER TABLE "PostPlatform" ADD COLUMN     "socialAccountId" TEXT;

-- 3. Indexes for the new tables (unique index on SocialAccount is created before
--    the data copy; the copy dedupes so it cannot violate the constraint) ------

-- CreateIndex
CREATE INDEX "SocialAccount_shop_idx" ON "SocialAccount"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_shop_platform_accountId_key" ON "SocialAccount"("shop", "platform", "accountId");

-- CreateIndex
CREATE INDEX "BrandSocialAccount_brandId_idx" ON "BrandSocialAccount"("brandId");

-- CreateIndex
CREATE INDEX "BrandSocialAccount_socialAccountId_idx" ON "BrandSocialAccount"("socialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandSocialAccount_brandId_socialAccountId_key" ON "BrandSocialAccount"("brandId", "socialAccountId");

-- CreateIndex
CREATE INDEX "PostPlatform_socialAccountId_idx" ON "PostPlatform"("socialAccountId");

-- 4. Foreign keys (added before the data copy; copy order below respects them) -

-- AddForeignKey
ALTER TABLE "BrandSocialAccount" ADD CONSTRAINT "BrandSocialAccount_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandSocialAccount" ADD CONSTRAINT "BrandSocialAccount_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPlatform" ADD CONSTRAINT "PostPlatform_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Copy OAuthToken rows into SocialAccount ----------------------------------
--    The SocialAccount id reuses the OAuthToken id and the encrypted token
--    strings copy verbatim (same ENCRYPTION_KEY, so they decrypt unchanged).
--    Two brands in the same shop could each hold a token for the SAME physical
--    account (same shop+platform+accountId); DISTINCT ON keeps only the newest
--    such row so the unique index is satisfied. All brands are still linked in
--    step 6 below regardless of which token row survived here.
INSERT INTO "SocialAccount" (
  "id", "shop", "platform", "accountId", "accountName",
  "accessToken", "refreshToken", "tokenSecret", "expiresAt",
  "createdAt", "updatedAt"
)
SELECT DISTINCT ON (b."shop", ot."platform", ot."accountId")
  ot."id", b."shop", ot."platform", ot."accountId", ot."accountName",
  ot."accessToken", ot."refreshToken", ot."tokenSecret", ot."expiresAt",
  ot."createdAt", ot."updatedAt"
FROM "OAuthToken" ot
JOIN "Brand" b ON b."id" = ot."brandId"
ORDER BY b."shop", ot."platform", ot."accountId", ot."updatedAt" DESC;

-- 6. Link every brand that held a token to its (deduped) SocialAccount ---------
--    One link row per OAuthToken row. Old data allowed at most one token per
--    (brand, platform), and SocialAccount is keyed by (shop, platform,
--    accountId), so each token maps to exactly one account and every
--    (brandId, socialAccountId) pair is unique.
INSERT INTO "BrandSocialAccount" ("id", "brandId", "socialAccountId")
SELECT ot."id" || '-link', ot."brandId", sa."id"
FROM "OAuthToken" ot
JOIN "Brand" b ON b."id" = ot."brandId"
JOIN "SocialAccount" sa
  ON sa."shop" = b."shop"
 AND sa."platform" = ot."platform"
 AND sa."accountId" = ot."accountId";

-- 7. Backfill PostPlatform.socialAccountId for non-manual rows -----------------
--    Resolve each platform row to the account the post's brand is linked to for
--    that platform. This mirrors the old semantics exactly (a post published via
--    its brand's single token per platform). Manual platforms (rednote) keep a
--    NULL account. Any row whose brand no longer has a linked account for the
--    platform stays NULL and is surfaced/failed with a clear message at publish.
UPDATE "PostPlatform" pp
SET "socialAccountId" = (
  SELECT bsa."socialAccountId"
  FROM "Post" p
  JOIN "BrandSocialAccount" bsa ON bsa."brandId" = p."brandId"
  JOIN "SocialAccount" sa ON sa."id" = bsa."socialAccountId"
  WHERE p."id" = pp."postId" AND sa."platform" = pp."platform"
  LIMIT 1
)
WHERE pp."platform" <> 'rednote';

-- 8. Swap the PostPlatform unique key from platform to socialAccountId ---------
--    Each post had unique platforms before, and different platforms resolve to
--    different accounts, so no (postId, socialAccountId) collision exists.

-- DropIndex
DROP INDEX "PostPlatform_postId_platform_key";

-- CreateIndex
CREATE UNIQUE INDEX "PostPlatform_postId_socialAccountId_key" ON "PostPlatform"("postId", "socialAccountId");

-- 9. Drop the old OAuthToken table --------------------------------------------

-- DropForeignKey
ALTER TABLE "OAuthToken" DROP CONSTRAINT "OAuthToken_brandId_fkey";

-- DropTable
DROP TABLE "OAuthToken";
