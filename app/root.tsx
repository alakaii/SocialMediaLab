import type { LinksFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from "@remix-run/react";

export const links: LinksFunction = () => [];

export const loader = async () => {
  // App Bridge reads the client id off its own script tag, so the key has to
  // reach the document head rather than a component deeper in the tree.
  return json({ apiKey: process.env.SHOPIFY_API_KEY ?? "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();

  // Built for Shopify requires App Bridge to load from Shopify's CDN as the
  // first script in <head>, and only on embedded pages. Everything under /app
  // renders inside the Shopify admin; /privacy and the auth routes do not, and
  // loading App Bridge there would try to embed a page that has no admin host.
  const isEmbeddedRoute = location.pathname.startsWith("/app");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        {isEmbeddedRoute && (
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key={apiKey}
          />
        )}
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
