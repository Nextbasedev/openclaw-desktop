const ROUTE_PREFIXES_TO_LEAVE_ALONE = ["/api", "/_next"]

declare global {
  interface Window {
    __OPENCLAW_ROUTE_PATCHED__?: boolean
    __TAURI_INTERNALS__?: Record<string, unknown>
  }
}

function isProbablyFilePath(path: string): boolean {
  const last = path.split("/").pop() ?? ""
  return last.includes(".")
}

export function shouldUseHashRoutes(): boolean {
  if (typeof window === "undefined") return false
  if (process.env.NEXT_PUBLIC_OPENCLAW_ROUTER_MODE === "hash") return true
  if (window.__TAURI_INTERNALS__) return true
  return window.location.protocol !== "http:" && window.location.protocol !== "https:"
}

function normalizePath(path: string): string {
  if (!path) return "/"
  if (path.startsWith("#")) path = path.slice(1)
  if (!path.startsWith("/")) path = `/${path}`
  return path
}

export function getRoutePath(): string {
  if (typeof window === "undefined") return "/"
  if (shouldUseHashRoutes()) {
    const hash = window.location.hash
    if (hash.startsWith("#/")) return normalizePath(hash.slice(1))
  }
  return normalizePath(window.location.pathname)
}

export function routeUrl(path: string): string {
  const normalized = normalizePath(path)
  if (!shouldUseHashRoutes()) return normalized
  if (normalized === "/") return "/"
  return `/#${normalized}`
}

function shouldRewriteUrl(url: unknown): url is string {
  if (!shouldUseHashRoutes() || typeof url !== "string" || !url) return false
  if (url.startsWith("#")) return false
  if (url.includes("#/")) return false

  let pathname = url
  try {
    const parsed = new URL(url, window.location.href)
    if (parsed.origin !== window.location.origin) return false
    pathname = parsed.pathname
  } catch {}

  if (!pathname.startsWith("/")) return false
  if (ROUTE_PREFIXES_TO_LEAVE_ALONE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false
  if (isProbablyFilePath(pathname)) return false
  return true
}

export function installDesktopRouteShim() {
  if (typeof window === "undefined" || window.__OPENCLAW_ROUTE_PATCHED__) return
  window.__OPENCLAW_ROUTE_PATCHED__ = true

  const rewrite = (url?: string | URL | null) => {
    if (!shouldRewriteUrl(url)) return url
    const parsed = new URL(url, window.location.href)
    return `${window.location.origin}${routeUrl(parsed.pathname)}${parsed.search}`
  }

  const pushState = window.history.pushState.bind(window.history)
  const replaceState = window.history.replaceState.bind(window.history)

  window.history.pushState = (data, unused, url) => pushState(data, unused, rewrite(url) as string | URL | null | undefined)
  window.history.replaceState = (data, unused, url) => replaceState(data, unused, rewrite(url) as string | URL | null | undefined)
}
