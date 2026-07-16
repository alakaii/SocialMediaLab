/**
 * Pulls existing images out of the merchant's store (linked product, collections,
 * and blog articles) so they can be reused as post media without re-uploading.
 * Returns plain Shopify CDN URLs, which MediaAsset.url can store directly.
 */

export type StoreMediaSource = "product" | "collection" | "blog";

export interface StoreMediaImage {
  url: string;
  altText: string | null;
  source: StoreMediaSource;
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

async function fetchProductImages(
  admin: AdminGraphqlClient,
  productId: string,
): Promise<StoreMediaImage[]> {
  const data = await runQuery<{
    product?: { images?: { edges?: { node?: ImageNode }[] } } | null;
  }>(admin, PRODUCT_IMAGES_QUERY, { id: productId });
  const edges = data?.product?.images?.edges ?? [];
  return edges
    .map((e) => e.node)
    .filter((n): n is ImageNode => Boolean(n?.url))
    .map((n) => ({ url: n.url as string, altText: n.altText ?? null, source: "product" as const }));
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

  const [productImages, collectionImages, articleImages] = await Promise.all([
    productId ? fetchProductImages(admin, productId) : Promise.resolve([]),
    fetchCollectionImages(admin, query),
    fetchArticleImages(admin),
  ]);

  // Product images first (most relevant when a product is linked), then
  // collections, then blog articles. De-duplicate by URL.
  const ordered = [...productImages, ...collectionImages, ...articleImages];
  const seen = new Set<string>();
  const result: StoreMediaImage[] = [];
  for (const img of ordered) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    result.push(img);
  }
  return result;
}
