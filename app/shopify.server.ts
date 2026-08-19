import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server.js";
import { fetchShopGid } from "./billing.server.js";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET ?? "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL ?? "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // No `billing` option: the app sells through Shopify App Pricing, which
  // disables the Billing API entirely. Subscription state is read from the
  // Partner API instead (see billing.server.ts).
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app/uninstalled",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await shopify.registerWebhooks({ session });

      // Capture the shop's GID at install. The Partner API identifies shops by
      // GID and accepts nothing else, so without this the first subscription
      // read has to spend an extra Admin call discovering it. Wrapped because a
      // failure here must never break the install: billing.server re-reads the
      // GID lazily when it is missing.
      try {
        const shopGid = await fetchShopGid(admin);
        if (shopGid) {
          await prisma.shopBilling.upsert({
            where: { shop: session.shop },
            update: { shopGid },
            create: { shop: session.shop, shopGid },
          });
        }
      } catch (err) {
        console.error("[auth] could not store the shop GID", err);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
