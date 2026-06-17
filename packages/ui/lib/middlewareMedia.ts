import { getMiddlewareConnection, type MiddlewareConnection } from "./middleware-client"

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function middlewareTargetUrl(baseUrl: string, path: string): string {
  try {
    return new URL(path, `${trimTrailingSlash(baseUrl)}/`).toString()
  } catch {
    return `${trimTrailingSlash(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`
  }
}

function withTokenQuery(url: string, token: string): string {
  const trimmedToken = token.trim()
  if (!trimmedToken) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set("token", trimmedToken)
    return parsed.toString()
  } catch {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}token=${encodeURIComponent(trimmedToken)}`
  }
}

export function buildAuthenticatedMiddlewareMediaUrl(
  path: string,
  connection: MiddlewareConnection | null = getMiddlewareConnection(),
): string | null {
  if (!connection?.url) return null
  return withTokenQuery(middlewareTargetUrl(connection.url, path), connection.token)
}

export function buildInboundMediaUrl(
  mediaId: string,
  connection?: MiddlewareConnection | null,
): string | null {
  const id = mediaId.trim()
  if (!id) return null
  return buildAuthenticatedMiddlewareMediaUrl(
    `/api/chat/media/inbound/${encodeURIComponent(id)}`,
    connection === undefined ? getMiddlewareConnection() : connection,
  )
}

export function buildOpenClawMediaUrl(
  mediaPath: string,
  connection?: MiddlewareConnection | null,
): string | null {
  const path = mediaPath.trim()
  if (!path) return null
  return buildAuthenticatedMiddlewareMediaUrl(
    `/api/chat/media/local?path=${encodeURIComponent(path)}`,
    connection === undefined ? getMiddlewareConnection() : connection,
  )
}
