import { prisma } from "../db.server.js";

/**
 * Per-shop settings. For now this just holds the holiday country used to
 * surface upcoming holidays in the scheduling flow.
 */
export async function getShopSettings(shop: string) {
  const existing = await prisma.shopSettings.findUnique({ where: { shop } });
  if (existing) return existing;
  return prisma.shopSettings.create({ data: { shop } });
}

export async function updateHolidayCountry(shop: string, holidayCountry: string) {
  return prisma.shopSettings.upsert({
    where: { shop },
    update: { holidayCountry },
    create: { shop, holidayCountry },
  });
}
