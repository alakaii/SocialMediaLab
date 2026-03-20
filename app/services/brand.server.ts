import { prisma } from "../db.server.js";

export async function getBrands(shop: string) {
  return prisma.brand.findMany({
    where: { shop },
    include: {
      oauthTokens: { select: { platform: true, accountName: true } },
      _count: { select: { posts: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getBrand(id: string, shop: string) {
  return prisma.brand.findFirst({
    where: { id, shop },
    include: {
      oauthTokens: true,
    },
  });
}

export async function createBrand(
  shop: string,
  data: { name: string; logoUrl?: string; timezone?: string },
) {
  return prisma.brand.create({
    data: { shop, ...data },
  });
}

export async function updateBrand(
  id: string,
  shop: string,
  data: { name?: string; logoUrl?: string; timezone?: string },
) {
  return prisma.brand.updateMany({
    where: { id, shop },
    data,
  });
}

export async function deleteBrand(id: string, shop: string) {
  return prisma.brand.deleteMany({ where: { id, shop } });
}
