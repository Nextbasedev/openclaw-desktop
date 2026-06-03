import { middlewareFetch, getMiddlewareConnection } from "@/lib/middleware-client";
import type { ChatTransport } from "../sync/apiClient";

function withQuery(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** ChatTransport backed by the app's middlewareFetch (auth + base URL handled there). */
export function createMiddlewareTransport(): ChatTransport {
  return {
    request<T>(path: string, init?: { method?: string; body?: unknown; query?: Record<string, unknown> }): Promise<T> {
      const url = withQuery(path, init?.query);
      const method = init?.method ?? "GET";
      const hasBody = init?.body !== undefined && method !== "GET";
      return middlewareFetch<T>(url, {
        method,
        ...(hasBody
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init?.body) }
          : {}),
      });
    },
  };
}

/** Resolve the current middleware base URL (for building the WS stream URL). */
export function currentMiddlewareBaseUrl(): string {
  return getMiddlewareConnection()?.url ?? "http://127.0.0.1:8787";
}
