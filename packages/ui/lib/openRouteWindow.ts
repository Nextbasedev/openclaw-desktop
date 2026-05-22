import { routeUrl } from "@/lib/app-router"

function newWindowId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `window-${random}`
}

function stableHash(value: string) {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function withWindowParams(url: string, params: Record<string, string | boolean | null | undefined>) {
  const [beforeHash, hash = ""] = url.split("#", 2)
  const separator = beforeHash.includes("?") ? "&" : "?"
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue
    query.set(key, String(value))
  }
  const queryString = query.toString()
  return `${beforeHash}${queryString ? `${separator}${queryString}` : ""}${hash ? `#${hash}` : ""}`
}

export function chatWindowLabel(chatIdOrSessionKey: string) {
  const raw = chatIdOrSessionKey.trim() || "unknown"
  const slug = raw
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 72)
    .replace(/^-+|-+$/g, "") || "chat"
  return `openclaw-chat-${slug}-${stableHash(raw)}`
}

export function routeWindowUrl(path: string, windowId = newWindowId(), nativeChrome = false) {
  return withWindowParams(routeUrl(path), {
    ...(nativeChrome ? { openclawNativeChrome: "1" } : {}),
    openclawWindowId: windowId,
  })
}

export function focusedChatWindowUrl(input: {
  chatId: string
  sessionKey?: string | null
  title?: string | null
  windowId?: string
  nativeChrome?: boolean
}) {
  const windowId = input.windowId ?? newWindowId()
  return withWindowParams(routeUrl(`/${encodeURIComponent(input.chatId)}`), {
    ...(input.nativeChrome ? { openclawNativeChrome: "1" } : {}),
    openclawWindowId: windowId,
    openclawWindowMode: "focused-chat",
    chatId: input.chatId,
    sessionKey: input.sessionKey ?? undefined,
    title: input.title ?? undefined,
  })
}

function isMacPlatform() {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? ""
  return platform.toLowerCase().includes("mac")
}

async function waitForTauriWindowCreated(win: {
  once: (event: string, handler: (event: { payload?: unknown }) => void) => Promise<() => void>
}) {
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
    await waitForTauriWindowCreated(win)
    return
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (!opened) throw new Error("Browser blocked the new window")
  opened.focus?.()
}

export async function openChatInFocusedWindow(input: {
  chatId: string
  sessionKey?: string | null
  title?: string | null
}) {
  const label = chatWindowLabel(input.chatId)
  const windowId = `focused-${label}`
  const title = input.title?.trim() || "OpenClaw Chat"
  const useNativeWindowChrome = isMacPlatform()
  const focusedUrl = focusedChatWindowUrl({
    chatId: input.chatId,
    sessionKey: input.sessionKey,
    title,
    windowId,
    nativeChrome: useNativeWindowChrome,
  })
  const absoluteUrl = typeof window === "undefined"
    ? focusedUrl
    : new URL(focusedUrl, window.location.href).toString()

  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow")
    const existing = await WebviewWindow.getByLabel(label)
    if (existing) {
      await existing.show().catch(() => {})
      await existing.setFocus().catch(() => {})
      await existing.emit("openclaw:focused-chat", input).catch(() => {})
      return
    }

    const win = new WebviewWindow(label, {
      url: focusedUrl,
      title,
      width: 980,
      height: 820,
      minWidth: 720,
      minHeight: 520,
      resizable: true,
      decorations: useNativeWindowChrome,
      center: true,
    })
    await waitForTauriWindowCreated(win)
    return
  }

  const opened = window.open(absoluteUrl, label, "popup")
  if (!opened) throw new Error("Browser blocked the new window")
  opened.focus?.()
}
