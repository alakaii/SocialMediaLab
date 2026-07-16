import { prisma } from "../db.server.js";

/**
 * Extract hashtags from post content. Matches a leading "#" followed by one or
 * more letters, numbers, or underscores (Unicode aware, so non-Latin tags work).
 * Returns a de-duplicated list preserving the original "#tag" form.
 */
export function parseHashtags(content: string): string[] {
  const matches = content.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of matches) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }
  return result;
}

/**
 * Record the hashtags used in a post for a linked product, so we can suggest
 * them next time the merchant posts about the same product. Each tag is upserted
 * and its usageCount incremented.
 */
export async function recordProductHashtags(
  shop: string,
  productId: string,
  content: string,
): Promise<void> {
  const hashtags = parseHashtags(content);
  if (hashtags.length === 0) return;

  await Promise.all(
    hashtags.map((hashtag) =>
      prisma.productHashtag.upsert({
        where: { shop_productId_hashtag: { shop, productId, hashtag } },
        create: { shop, productId, hashtag },
        update: { usageCount: { increment: 1 } },
      }),
    ),
  );
}

/**
 * Fetch a product's most-used hashtags for this shop, ranked by usageCount
 * descending (ties broken by most recently used). Used to show clickable
 * suggestion chips in the wizard.
 */
export async function getProductHashtags(
  shop: string,
  productId: string,
  limit = 10,
): Promise<{ hashtag: string; usageCount: number }[]> {
  const rows = await prisma.productHashtag.findMany({
    where: { shop, productId },
    orderBy: [{ usageCount: "desc" }, { lastUsedAt: "desc" }],
    take: limit,
    select: { hashtag: true, usageCount: true },
  });
  return rows;
}
