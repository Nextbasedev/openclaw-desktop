/**
 * A HTTPS web app must not send credentials or chat data to an arbitrary HTTP
 * middleware endpoint. Desktop and local development are unaffected because
 * they do not run from an HTTPS page.
 */
export function assertMiddlewareUrlIsSafeForBrowser(rawUrl: string): void {
  if (typeof window === "undefined" || window.location.protocol !== "https:") return

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error("Middleware URL must be a valid HTTPS URL.")
  }

  if (url.protocol === "http:") {
    throw new Error("This HTTPS app can only connect to an HTTPS middleware URL. Deploy the middleware behind TLS and use its https:// URL.")
  }
}
