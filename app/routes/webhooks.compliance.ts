import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import shopify from "../shopify.server.js";
import {
  logCustomerDataRequest,
  logCustomerRedact,
  purgeShopData,
} from "../services/gdpr.server.js";

/**
 * Shopify's three mandatory compliance webhooks, declared in shopify.app.toml
 * under `compliance_topics` (they cannot be registered through the Admin API, so
 * they are deliberately absent from the `webhooks` config in shopify.server.ts).
 *
 * `authenticate.webhook` verifies the HMAC and throws a 401 Response when it
 * fails; that throw must propagate untouched, so nothing here wraps it.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await shopify.authenticate.webhook(request);

  // `topic` is typed from the `webhooks` config in shopify.server.ts, which by
  // design does not list the compliance topics. Widen it so we can dispatch.
  const complianceTopic: string = topic;

  switch (complianceTopic) {
    case "CUSTOMERS_DATA_REQUEST":
      // The app stores no shopper data, so there is nothing to hand back.
      logCustomerDataRequest(shop, payload);
      break;

    case "CUSTOMERS_REDACT":
      // The app stores no shopper data, so there is nothing to erase.
      logCustomerRedact(shop, payload);
      break;

    case "SHOP_REDACT":
      await purgeShopData(shop);
      break;

    default:
      console.warn("[gdpr] unhandled compliance topic", { shop, topic: complianceTopic });
      break;
  }

  return json({ ok: true });
};
