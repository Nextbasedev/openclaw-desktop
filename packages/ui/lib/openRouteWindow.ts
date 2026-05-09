import { routeUrl } from "@/lib/app-router"

function absoluteRouteUrl(path: string) {
  if (typeof window === "undefined") return routeUrl(path)
  return new URL(routeUrl(path), window.location.href).toString()
}

export async function openRouteInNewWindow(path: string, title = "OpenClaw") {
  const url = absoluteRouteUrl(path)

  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow")
    const label = `openclaw-chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const win = new WebviewWindow(label, {
      url: routeUrl(path),
      title,
      width: 1280,
      height: 860,
      resizable: true,
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
