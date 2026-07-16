import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

// Shopify loads the embedded app at the application_url root with the
// session params (shop, host, id_token) in the query string. The app UI
// lives under /app, so forward embedded requests there with the params
// intact; anything else is a stray visit to the bare domain.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return new Response("Social Media Lab", {
    headers: { "Content-Type": "text/plain" },
  });
};
