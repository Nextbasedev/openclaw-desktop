const URL_KEY = "openclaw.middleware.url"
const TOKEN_KEY = "openclaw.middleware.token"

export type MiddlewareConnection = {
  url: string
  token: string
}

export type MiddlewareHealth = {
  ok: boolean
  service: string
  version: string
  host?: string
  openclaw?: { gatewayUrl?: string; connected?: boolean }
  pairing?: { enabled?: boolean }
}

export type MiddlewarePairingResult = MiddlewareConnection & {
  ok: boolean
  mode?: "local" | "remote"
}

const LOCAL_MIDDLEWARE_URLS = [
  "http://127.0.0.1:8787",
  "http://localhost:8787",
  "http://127.0.0.1:8788",
  "http://127.0.0.1:8799",
]

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "")
}

export function getMiddlewareConnection(): MiddlewareConnection | null {
  if (typeof window === "undefined") return null
  const url = localStorage.getItem(URL_KEY)?.trim() ?? ""
  const token = localStorage.getItem(TOKEN_KEY)?.trim() ?? ""
  if (!url || !token) return null
  return { url, token }
}

export function saveMiddlewareConnection(input: MiddlewareConnection) {
  if (typeof window === "undefined") return
  localStorage.setItem(URL_KEY, trimTrailingSlash(input.url))
  localStorage.setItem(TOKEN_KEY, input.token.trim())
  localStorage.setItem("jarvis.gatewayActive", "true")
}

export function clearMiddlewareConnection() {
  if (typeof window === "undefined") return
  localStorage.removeItem(URL_KEY)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.setItem("jarvis.gatewayActive", "false")
}

export async function middlewareFetch<T>(path: string, init: RequestInit = {}, connection = getMiddlewareConnection()): Promise<T> {
  if (!connection) throw new Error("Middleware connection is not configured")
  const response = await fetch(`${trimTrailingSlash(connection.url)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${connection.token}`,
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Middleware request failed (${response.status})`)
  }
  return body as T
}

export async function testMiddlewareConnection(input: MiddlewareConnection): Promise<MiddlewareHealth> {
  const url = trimTrailingSlash(input.url)
  const healthRes = await fetch(`${url}/health`, { headers: { "Cache-Control": "no-cache" } })
  if (!healthRes.ok) throw new Error(`Middleware health failed (${healthRes.status})`)
  const health = await healthRes.json() as MiddlewareHealth
  await middlewareFetch("/api/version", {}, { url, token: input.token.trim() })
  return health
}

export async function claimMiddlewarePairing(input: { url: string; code: string }): Promise<MiddlewarePairingResult> {
  const url = trimTrailingSlash(input.url)
  const response = await fetch(`${url}/pairing/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: input.code.trim() }),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.error?.message ?? `Pairing failed (${response.status})`)
  return { ok: true, url: trimTrailingSlash(body.url || url), token: String(body.token ?? ""), mode: body.mode }
}

export async function detectLocalMiddleware(urls = LOCAL_MIDDLEWARE_URLS): Promise<MiddlewarePairingResult | null> {
  for (const rawUrl of urls) {
    const url = trimTrailingSlash(rawUrl)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 800)
      const health = await fetch(`${url}/health`, { signal: controller.signal, headers: { "Cache-Control": "no-cache" } })
      clearTimeout(timeout)
      if (!health.ok) continue
      const pair = await fetch(`${url}/pairing/local`, { signal: controller.signal })
      if (!pair.ok) continue
      const body = await pair.json()
      if (body?.token) return { ok: true, url: trimTrailingSlash(body.url || url), token: String(body.token), mode: "local" }
    } catch {}
  }
  return null
}
