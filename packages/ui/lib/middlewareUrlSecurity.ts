/**
 * A HTTPS web app must not send credentials or chat data to an arbitrary HTTP
 * middleware endpoint. Desktop and local development are unaffected because
 * they do not run from an HTTPS page.
 */
export function assertMiddlewareUrlIsSafeForBrowser(rawUrl: string): void {
  if (isMiddlewareUrlSafeForBrowser(rawUrl)) return

  throw new Error("This HTTPS app can only connect to an HTTPS middleware URL. Deploy the middleware behind TLS and use its https:// URL.")
}

export function isMiddlewareUrlSafeForBrowser(rawUrl: string): boolean {
  if (typeof window === "undefined" || window.location.protocol !== "https:") return true

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  return url.protocol === "https:"
}
