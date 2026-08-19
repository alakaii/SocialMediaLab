import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner, Box } from "@shopify/polaris";
import type { BannerProps } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import shopify from "../shopify.server.js";
import { BILLING_PLAN_PATH, TIER_NONE, resolveTier } from "../billing.server.js";
import { getActiveGlobalBanner, isOwnerShop } from "../services/owner.server.js";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await shopify.authenticate.admin(request);

  // Subscription gate for every page under /app. The plan page itself is exempt,
  // otherwise an unsubscribed shop would be redirected to it forever. This runs
  // after authenticate.admin, so the OAuth and exit-iframe flows (which live
  // outside /app) are untouched.
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BILLING_PLAN_PATH)) {
    const { tier } = await resolveTier({ shop: session.shop, admin });
    if (tier === TIER_NONE) {
      // Keep the query string so shop/host/embedded survive a document load.
      throw redirect(`${BILLING_PLAN_PATH}${url.search}`);
    }
  }

  // The owner surface sits under /app, so it is behind the tier gate above on
  // purpose: the owner store subscribes through a private plan like anyone else.
  const globalBanner = await getActiveGlobalBanner();

  return json({
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    globalBanner,
    isOwner: isOwnerShop(session.shop),
  });
};

/** The tones Polaris Banner accepts. Anything else stored falls back to info. */
const BANNER_TONES = ["info", "warning", "critical", "success"] as const;

function bannerTone(tone: string): NonNullable<BannerProps["tone"]> {
  return (BANNER_TONES as readonly string[]).includes(tone)
    ? (tone as NonNullable<BannerProps["tone"]>)
    : "info";
}

export default function AppLayout() {
  const { apiKey, globalBanner, isOwner } = useLoaderData<typeof loader>();

  return (
    // isEmbeddedApp is false on purpose. In this version of
    // @shopify/shopify-app-remix the prop does exactly one thing: it renders a
    // second copy of the App Bridge CDN script. Built for Shopify wants that
    // script in the document head, so it lives in root.tsx instead and this
    // copy is suppressed. Everything else here still passes through to Polaris.
    <AppProvider isEmbeddedApp={false} apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/posts">Posts</Link>
        <Link to="/app/brands">Brands</Link>
        <Link to="/app/connections">Connections</Link>
        <Link to="/app/billing">Plan</Link>
        {/* Discoverability for us, not a lock. The route itself 404s for
            everyone who is not the owner store. */}
        {isOwner ? <Link to="/app/owner">Owner</Link> : null}
      </NavMenu>
      {globalBanner && (
        // Deliberately not dismissible: this is the outage and maintenance
        // channel, and a merchant who dismissed it would stop seeing why the
        // app is behaving strangely.
        <Box paddingInline="400" paddingBlockStart="400">
          <Banner tone={bannerTone(globalBanner.tone)}>
            {globalBanner.message}
          </Banner>
        </Box>
      )}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;
