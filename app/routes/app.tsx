import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import shopify from "../shopify.server.js";
import { BILLING_PLAN_PATH, MONTHLY_PLAN, isTestBilling } from "../billing.server.js";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await shopify.authenticate.admin(request);

  // Billing gate for every page under /app. The plan-selection page itself is
  // exempt, otherwise an unsubscribed shop would be redirected to it forever.
  // This runs after authenticate.admin, so the OAuth and exit-iframe flows
  // (which live outside /app) are untouched.
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BILLING_PLAN_PATH)) {
    await billing.require({
      plans: [MONTHLY_PLAN],
      isTest: isTestBilling(),
      // Keep the query string so shop/host/embedded survive a document load.
      onFailure: async () => redirect(`${BILLING_PLAN_PATH}${url.search}`),
    });
  }

  return json({ apiKey: process.env.SHOPIFY_API_KEY ?? "" });
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/posts">Posts</Link>
        <Link to="/app/brands">Brands</Link>
        <Link to="/app/connections">Connections</Link>
        <Link to="/app/billing">Plan</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = boundary.headers;
