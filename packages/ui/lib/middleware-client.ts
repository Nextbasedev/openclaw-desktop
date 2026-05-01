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
}

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
