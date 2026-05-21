import { routeUrl } from "@/lib/app-router"

function newWindowId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `window-${random}`
}

function withWindowParams(url: string, params: Record<string, string | boolean>) {
  const [beforeHash, hash = ""] = url.split("#", 2)
  const separator = beforeHash.includes("?") ? "&" : "?"
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) query.set(key, String(value))
  return `${beforeHash}${separator}${query.toString()}${hash ? `#${hash}` : ""}`
}

export function routeWindowUrl(path: string, windowId = newWindowId(), nativeChrome = false) {
  return withWindowParams(routeUrl(path), {
    ...(nativeChrome ? { openclawNativeChrome: true } : {}),
    openclawWindowId: windowId,
  })
}

function isMacPlatform() {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? ""
  return platform.toLowerCase().includes("mac")
}

export async function openRouteInNewWindow(path: string, title = "OpenClaw") {
  const windowId = newWindowId()
  const url = typeof window === "undefined"
    ? routeWindowUrl(path, windowId)
    : new URL(routeWindowUrl(path, windowId), window.location.href).toString()

  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow")
    const label = `openclaw-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const useNativeWindowChrome = isMacPlatform()
    const win = new WebviewWindow(label, {
      url: routeWindowUrl(path, windowId, useNativeWindowChrome),
      title,
      width: 1280,
      height: 860,
      resizable: true,
      decorations: useNativeWindowChrome,
      center: true,
    })
    await new Promise<void>((resolve, reject) => {
      const unlistenCreated = win.once("tauri://created", () => {
        void unlistenCreated.then((fn) => fn())
        void unlistenError.then((fn) => fn())
        resolve()
      })
      const unlistenError = win.once("tauri://error", (event) => {
        void unlistenCreated.then((fn) => fn())
        void unlistenError.then((fn) => fn())
        reject(new Error(String(event.payload ?? "Failed to open window")))
      })
    })
    return
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) throw new Error("Browser blocked the new window")
  opened.focus?.()
}
