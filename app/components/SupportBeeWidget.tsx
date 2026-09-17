import { useEffect, useRef } from "react";

/**
 * Support Bee chat bubble for a Remix app shell. Copy this file into the app
 * as `app/components/SupportBeeWidget.tsx` and render it from the layout
 * route so it is reachable from every page:
 *
 *   {supportBee ? <SupportBeeWidget {...supportBee} appName="Etsy Warlock" /> : null}
 *
 * where `supportBee` is `supportBeeWidgetConfig({ sub: session.shop })` from
 * the loader (see support-bee.server.ts), or null when the env vars are unset.
 *
 * The script is injected once. Loaders re-run on every navigation and mint a
 * fresh token each time; that token is handed to the running widget with
 * setToken() rather than re-creating it, so an open panel stays open.
 */

interface SupportBeeWidgetProps {
  url: string;
  source: string;
  token: string;
  appName: string;
}

type SupportBeeGlobal = {
  destroy(): void;
  setToken(token: string): void;
};

function supportBee(): SupportBeeGlobal | undefined {
  return (window as unknown as { SupportBee?: SupportBeeGlobal }).SupportBee;
}

export function SupportBeeWidget({ url, source, token, appName }: SupportBeeWidgetProps) {
  const latestToken = useRef(token);
  latestToken.current = token;

  useEffect(() => {
    const script = document.createElement("script");
    script.src = `${url}/widget.js`;
    script.async = true;
    script.dataset.source = source;
    script.dataset.token = latestToken.current;
    script.dataset.appName = appName;
    document.body.appendChild(script);
    return () => {
      supportBee()?.destroy();
      script.remove();
    };
  }, [url, source, appName]);

  useEffect(() => {
    supportBee()?.setToken(token);
  }, [token]);

  return null;
}
