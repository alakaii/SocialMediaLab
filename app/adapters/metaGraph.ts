import axios from "axios";

// Shared Graph API version for all Meta (Facebook + Instagram) adapters and the
// OAuth / page-selection flow. Keep this consistent everywhere.
export const GRAPH_VERSION = "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number };
}

// Turns an axios/Graph failure into a clean Error that surfaces the Graph API
// error.message, so a failed publish records a readable errorMessage.
export function metaGraphError(err: unknown, context: string): Error {
  if (axios.isAxiosError(err)) {
    const body = err.response?.data as GraphErrorBody | undefined;
    const message = body?.error?.message;
    if (message) return new Error(`${context}: ${message}`);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`${context}: ${message}`);
}
