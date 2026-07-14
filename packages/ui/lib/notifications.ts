"use client"

import type { Options as NotificationOptions } from "@tauri-apps/plugin-notification"
import { invoke } from "@/lib/ipc"

let permissionCache: boolean | null = null

const RECENT_CHAT_NOTIFICATION_TTL_MS = 30_000
const recentChatNotifications = new Map<string, number>()

function chatNotificationKey(title: string, sessionKey: string, body: string): string {
  return `${sessionKey}\u0000${title}\u0000${body}`
}

function shouldSkipDuplicateChatNotification(title: string, sessionKey: string, body: string, now = Date.now()): boolean {
  const cutoff = now - RECENT_CHAT_NOTIFICATION_TTL_MS
  for (const [key, timestamp] of recentChatNotifications) {
    if (timestamp < cutoff) recentChatNotifications.delete(key)
  }

  const key = chatNotificationKey(title, sessionKey, body)
  const previous = recentChatNotifications.get(key)
  if (previous !== undefined && previous >= cutoff) return true
  recentChatNotifications.set(key, now)
  return false
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false
  return Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
}

function canUseBrowserNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

async function checkTauriPermission(): Promise<boolean> {
  const { isPermissionGranted } = await import("@tauri-apps/plugin-notification")
  const granted = await isPermissionGranted()
  permissionCache = granted
  return granted
}

async function checkPermission(): Promise<boolean> {
  if (permissionCache !== null) return permissionCache
  if (isTauriRuntime()) {
    return checkTauriPermission()
  }
  const granted = canUseBrowserNotifications() && Notification.permission === "granted"
  permissionCache = granted
  return granted
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const granted = await checkPermission()
  if (granted) return true
  if (isTauriRuntime()) {
    const { requestPermission } = await import("@tauri-apps/plugin-notification")
    const result = await requestPermission()
    permissionCache = result === "granted"
    return permissionCache
  }
  if (!canUseBrowserNotifications()) {
    permissionCache = false
    return false
  }
  const result = await Notification.requestPermission()
  permissionCache = result === "granted"
  return permissionCache
}

export async function notify(options: NotificationOptions): Promise<void> {
  const hasPermission = await ensureNotificationPermission()
  if (!hasPermission) return
  if (isTauriRuntime()) {
    const { sendNotification } = await import("@tauri-apps/plugin-notification")
    sendNotification(options)
    return
  }
  if (canUseBrowserNotifications()) {
    new Notification(options.title, { body: options.body })
  }
}

function isWindowsTauri(): boolean {
  if (typeof window === "undefined") return false
  const w = window as unknown as Record<string, unknown>
  if (!isTauriRuntime()) return false
  return navigator.userAgent.includes("Windows") || (w.__TAURI_PLATFORM__ as string) === "windows"
}

export async function notifyChatComplete(
  sessionTitle: string,
  sessionKey: string,
  preview?: string,
): Promise<void> {
  const body = preview
    ? preview.length > 80
      ? preview.slice(0, 80) + "…"
      : preview
    : "Your response is ready"

  const title = sessionTitle || "OpenClaw"
  if (shouldSkipDuplicateChatNotification(title, sessionKey, body)) return

  console.log("[notifyChatComplete] checking permission...")
  const hasPermission = await ensureNotificationPermission()
  console.log("[notifyChatComplete] permission:", hasPermission)
  if (!hasPermission) {
    console.warn("[notifyChatComplete] permission denied")
    return
  }

  if (isWindowsTauri()) {
    console.log("[notifyChatComplete] Windows path — invoking show_reply_notification")
    try {
      await invoke("show_reply_notification", {
        title,
        body,
        sessionKey,
      })
      console.log("[notifyChatComplete] custom toast sent")
      return
    } catch (err) {
      console.error("[notifyChatComplete] custom toast failed, falling back:", err)
    }
  }

  console.log("[notifyChatComplete] sending standard notification")
  await notify({
    title,
    body,
  })
  console.log("[notifyChatComplete] standard notification sent")
}

// Manual test helpers — call from DevTools console:
// window.__testNotification__("Test Title", "test-session", "Test body text")
// window.__testStandardNotification__("Test Title", "Test body")
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__testNotification__ = (
    title?: string,
    sessionKey?: string,
    body?: string,
  ) => notifyChatComplete(title || "Test", sessionKey || "test-session", body || "This is a test notification")

  ;(window as unknown as Record<string, unknown>).__testStandardNotification__ = async (
    title?: string,
    body?: string,
  ) => {
    const hasPermission = await ensureNotificationPermission()
    console.log("[testStandard] permission:", hasPermission)
    if (!hasPermission) {
      console.warn("[testStandard] permission denied")
      return
    }
    console.log("[testStandard] sending...")
    await notify({ title: title || "Standard Test", body: body || "This is a standard notification" })
    console.log("[testStandard] sent")
  }

  ;(window as unknown as Record<string, unknown>).__testCustomToastOnly__ = async (
    title?: string,
    sessionKey?: string,
    body?: string,
  ) => {
    console.log("[testCustomToastOnly] invoking show_reply_notification...")
    try {
      await invoke("show_reply_notification", {
        title: title || "Custom Toast Test",
        body: body || "Reply test",
        sessionKey: sessionKey || "test-session",
      })
      console.log("[testCustomToastOnly] invoke succeeded")
    } catch (err) {
      console.error("[testCustomToastOnly] invoke FAILED:", err)
    }
  }
}
