import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { AtpAgent } from "@atproto/api";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { upsertSocialAccount, associateAccountWithBrand } from "../services/oauth.server.js";
import { Platform } from "../types/post.js";

const BLUESKY_SERVICE = "https://bsky.social";

// Connects a Bluesky account using an app password (Bluesky does not use OAuth).
// Verifies the credentials by logging in, then stores them as a shop-level
// account via upsertSocialAccount (accessToken = app password, tokenSecret =
// handle, accountId = DID, accountName = handle) and links it to the brand the
// merchant started from. Tokens are encrypted transparently by oauth.server.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);

  const formData = await request.formData();
  const brandId = String(formData.get("brandId") ?? "");
  const handleRaw = String(formData.get("handle") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();

  if (!brandId) {
    return json({ ok: false, error: "Missing brand." }, { status: 400 });
  }
  if (!handleRaw || !appPassword) {
    return json(
      { ok: false, error: "Enter both your handle and app password." },
      { status: 400 },
    );
  }

  // Verify brand ownership (mirror api.oauth.$platform.ts).
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.shop !== session.shop) {
    throw new Response("Brand not found", { status: 404 });
  }

  // Normalise the handle: strip a leading "@" if the merchant typed one.
  const identifier = handleRaw.replace(/^@/, "");

  const agent = new AtpAgent({ service: BLUESKY_SERVICE });

  try {
    await agent.login({ identifier, password: appPassword });
  } catch {
    return json(
      {
        ok: false,
        error:
          "Could not connect. Check that the handle and app password are correct.",
      },
      { status: 400 },
    );
  }

  const did = agent.session?.did;
  const handle = agent.session?.handle ?? identifier;
  if (!did) {
    return json(
      { ok: false, error: "Bluesky did not return an account id. Try again." },
      { status: 400 },
    );
  }

  const account = await upsertSocialAccount({
    shop: session.shop,
    platform: Platform.Bluesky,
    accountId: did,
    accountName: handle,
    accessToken: appPassword,
    tokenSecret: handle,
  });
  await associateAccountWithBrand(account.id, brandId);

  return json({ ok: true });
};
