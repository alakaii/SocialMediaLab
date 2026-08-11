/**
 * Pulls existing images out of the merchant's store (linked product and its
 * variants, collections, and blog articles) so they can be reused as post media
 * without re-uploading. Returns plain Shopify CDN URLs, which MediaAsset.url can
 * store directly.
 */

import { DEFAULT_VARIANT_TITLE } from "../utils/product.js";

export type StoreMediaSource = "product" | "variant" | "collection" | "blog";

export interface StoreMediaImage {
  url: string;
  altText: string | null;
  source: StoreMediaSource;
  // Set when the image belongs to a specific variant, so the picker can surface
  // and label the image of the variant a post links to.
  variantId?: string | null;
  variantTitle?: string | null;
}

// Minimal shape of the admin GraphQL client returned by authenticate.admin.
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ImageNode {
  url?: string | null;
  altText?: string | null;
}

async function runQuery<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const response = await admin.graphql(query, variables ? { variables } : undefined);
    const body = (await response.json()) as { data?: T; errors?: unknown };
    if (!body || body.errors || !body.data) return null;
    return body.data;
  } catch {
    return null;
  }
}

const PRODUCT_IMAGES_QUERY = `#graphql
  query PostProductImages($id: ID!) {
    product(id: $id) {
      images(first: 25) {
        edges { node { url altText } }
      }
      variants(first: 100) {
        edges { node { id title image { url altText } } }
      }
    }
  }
`;

const COLLECTION_IMAGES_QUERY = `#graphql
  query PostCollectionImages($query: String) {
    collections(first: 25, query: $query) {
      edges { node { image { url altText } } }
    }
  }
`;

const ARTICLE_IMAGES_QUERY = `#graphql
  query PostArticleImages {
    articles(first: 50) {
      edges { node { image { url altText } } }
    }
  }
`;

interface VariantNode {
  id?: string | null;
  title?: string | null;
  image?: ImageNode | null;
}

/**
 * Gallery images of the product plus the image of each of its variants, in one
 * round trip. Variants named "Default Title" belong to products with no real
 * variants, so they are skipped.
 */
async function fetchProductImages(
  admin: AdminGraphqlClient,
  productId: string,
): Promise<{ productImages: StoreMediaImage[]; variantImages: StoreMediaImage[] }> {
  const data = await runQuery<{
    product?: {
      images?: { edges?: { node?: ImageNode }[] };
      variants?: { edges?: { node?: VariantNode }[] };
    } | null;
  }>(admin, PRODUCT_IMAGES_QUERY, { id: productId });

  const productImages = (data?.product?.images?.edges ?? [])
    .map((e) => e.node)
    .filter((n): n is ImageNode => Boolean(n?.url))
    .map((n) => ({ url: n.url as string, altText: n.altText ?? null, source: "product" as const }));

  const variantImages: StoreMediaImage[] = [];
  for (const edge of data?.product?.variants?.edges ?? []) {
    const node = edge.node;
    if (!node?.id || !node.image?.url) continue;
    if (!node.title || node.title === DEFAULT_VARIANT_TITLE) continue;
    variantImages.push({
      url: node.image.url,
      altText: node.image.altText ?? null,
      source: "variant",
      variantId: node.id,
      variantTitle: node.title,
    });
  }

  return { productImages, variantImages };
}

async function fetchCollectionImages(
  admin: AdminGraphqlClient,
  query?: string,
): Promise<StoreMediaImage[]> {
  const data = await runQuery<{
    collections?: { edges?: { node?: { image?: ImageNode | null } }[] };
  }>(admin, COLLECTION_IMAGES_QUERY, query ? { query } : {});
  const edges = data?.collections?.edges ?? [];
  return edges
    .map((e) => e.node?.image)
    .filter((img): img is ImageNode => Boolean(img?.url))
    .map((img) => ({ url: img.url as string, altText: img.altText ?? null, source: "collection" as const }));
}

async function fetchArticleImages(admin: AdminGraphqlClient): Promise<StoreMediaImage[]> {
  // Blog articles require the read_content scope. runQuery already swallows the
  // error and returns null, so a missing scope simply yields no blog images.
  const data = await runQuery<{
    articles?: { edges?: { node?: { image?: ImageNode | null } }[] };
  }>(admin, ARTICLE_IMAGES_QUERY);
  const edges = data?.articles?.edges ?? [];
  return edges
    .map((e) => e.node?.image)
    .filter((img): img is ImageNode => Boolean(img?.url))
    .map((img) => ({ url: img.url as string, altText: img.altText ?? null, source: "blog" as const }));
}

export async function getStoreMedia(
  admin: AdminGraphqlClient,
  opts: { productId?: string | null; query?: string | null } = {},
): Promise<StoreMediaImage[]> {
  const productId = opts.productId?.trim() || null;
  const query = opts.query?.trim() || undefined;

  const [product, collectionImages, articleImages] = await Promise.all([
    productId
      ? fetchProductImages(admin, productId)
      : Promise.resolve({ productImages: [], variantImages: [] }),
    fetchCollectionImages(admin, query),
    fetchArticleImages(admin),
  ]);

  // Product images first (most relevant when a product is linked), then the
  // variant images, then collections, then blog articles. De-duplicate by URL.
  const ordered = [
    ...product.productImages,
    ...product.variantImages,
    ...collectionImages,
    ...articleImages,
  ];
  const seen = new Map<string, StoreMediaImage>();
  const result: StoreMediaImage[] = [];
  for (const img of ordered) {
    const kept = seen.get(img.url);
    if (kept) {
      // The same file is often both a gallery image and a variant image. Keep
      // the first entry, but remember the variant it belongs to so the picker
      // can still surface it for that variant.
      if (!kept.variantId && img.variantId) {
        kept.variantId = img.variantId;
        kept.variantTitle = img.variantTitle;
      }
      continue;
    }
    const copy = { ...img };
    seen.set(copy.url, copy);
    result.push(copy);
  }
  return result;
}
