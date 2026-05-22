import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const tauriMocks = vi.hoisted(() => {
  const getByLabel = vi.fn()
  const WebviewWindow = vi.fn(function WebviewWindow(this: { once: (event: string, handler: (event: { payload?: unknown }) => void) => Promise<() => void> }) {
    this.once = vi.fn(async (event: string, handler: (event: { payload?: unknown }) => void) => {
      if (event === "tauri://created") queueMicrotask(() => handler({}))
      return () => {}
    })
  })
  return { getByLabel, WebviewWindow }
})

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: Object.assign(tauriMocks.WebviewWindow, {
    getByLabel: tauriMocks.getByLabel,
  }),
}))

import {
  chatWindowLabel,
  focusedChatWindowUrl,
  openChatInFocusedWindow,
  routeWindowUrl,
} from "./openRouteWindow"

function mockWindow(overrides: Partial<Window> = {}) {
  vi.stubGlobal("window", {
    location: { protocol: "file:", href: "file:///app/index.html" },
    __TAURI_INTERNALS__: {},
    open: vi.fn(),
    ...overrides,
  })
}

describe("openRouteWindow", () => {
  beforeEach(() => {
    mockWindow()
    tauriMocks.getByLabel.mockReset()
    tauriMocks.WebviewWindow.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("places window params before the hash route", () => {
    expect(routeWindowUrl("/chat-1", "window-test")).toBe(
      "/?openclawWindowId=window-test#/chat-1",
    )
  })

  it("adds native chrome only when requested", () => {
    expect(routeWindowUrl("/chat-1", "window-test", false)).toBe(
      "/?openclawWindowId=window-test#/chat-1",
    )
    expect(routeWindowUrl("/chat-1", "window-test", true)).toBe(
      "/?openclawNativeChrome=1&openclawWindowId=window-test#/chat-1",
    )
  })

  it("creates deterministic safe chat window labels", () => {
    expect(chatWindowLabel("agent:main:telegram:group:-100:topic:42")).toBe(
      chatWindowLabel("agent:main:telegram:group:-100:topic:42"),
    )
    expect(chatWindowLabel("agent main/$unsafe")).toMatch(/^openclaw-chat-agent-main-unsafe-[a-z0-9]+$/)
    expect(chatWindowLabel("agent:main/chat")).toMatch(/^openclaw-chat-agent-main-chat-[a-z0-9]+$/)
  })

  it("builds focused chat URLs with focused mode metadata", () => {
    expect(focusedChatWindowUrl({
      chatId: "chat-1",
      sessionKey: "session-1",
      title: "Support Chat",
      windowId: "focused-window",
      nativeChrome: true,
    })).toBe(
      "/?openclawNativeChrome=1&openclawWindowId=focused-window&openclawWindowMode=focused-chat&chatId=chat-1&sessionKey=session-1&title=Support+Chat#/chat-1",
    )
  })

  it("uses named browser windows for focused chats so duplicate opens reuse the target", async () => {
    const focus = vi.fn()
    const open = vi.fn(() => ({ focus }))
    mockWindow({
      location: { protocol: "http:", href: "http://localhost:3000/" } as Location,
      __TAURI_INTERNALS__: undefined,
      open: open as unknown as Window["open"],
    })

    await openChatInFocusedWindow({ chatId: "chat-1", sessionKey: "session-1", title: "Chat 1" })

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("openclawWindowMode=focused-chat"),
      chatWindowLabel("chat-1"),
      "popup",
    )
    expect(focus).toHaveBeenCalled()
  })

  it("keeps the focused window target stable when sessionKey availability changes", async () => {
    const focus = vi.fn()
    const open = vi.fn(() => ({ focus }))
    mockWindow({
      location: { protocol: "http:", href: "http://localhost:3000/" } as Location,
      __TAURI_INTERNALS__: undefined,
      open: open as unknown as Window["open"],
    })

    await openChatInFocusedWindow({ chatId: "chat-1", title: "Chat 1" })
    await openChatInFocusedWindow({ chatId: "chat-1", sessionKey: "session-1", title: "Chat 1" })

    expect(open).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("openclawWindowMode=focused-chat"),
      chatWindowLabel("chat-1"),
      "popup",
    )
    expect(open).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("sessionKey=session-1"),
      chatWindowLabel("chat-1"),
      "popup",
    )
  })

  it("focuses an existing Tauri focused chat window instead of constructing a duplicate", async () => {
    const existing = {
      show: vi.fn(async () => {}),
      setFocus: vi.fn(async () => {}),
      emit: vi.fn(async () => {}),
    }
    tauriMocks.getByLabel.mockResolvedValue(existing)

    await openChatInFocusedWindow({ chatId: "chat-1", sessionKey: "session-1", title: "Chat 1" })

    expect(tauriMocks.getByLabel).toHaveBeenCalledWith(chatWindowLabel("chat-1"))
    expect(existing.show).toHaveBeenCalled()
    expect(existing.setFocus).toHaveBeenCalled()
    expect(existing.emit).toHaveBeenCalledWith("openclaw:focused-chat", {
      chatId: "chat-1",
      sessionKey: "session-1",
      title: "Chat 1",
    })
    expect(tauriMocks.WebviewWindow).not.toHaveBeenCalled()
  })
})
