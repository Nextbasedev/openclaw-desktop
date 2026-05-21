import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  currentWorkspaceLayoutWindowId,
  loadWorkspaceLayoutSnapshot,
  workspaceLayoutCacheKey,
  type WorkspaceLayoutSnapshot,
} from "./workspaceLayoutPersistence"
import { persistentCacheClearAll, persistentCacheSet } from "./persistentCache"

function createStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size },
  }
}

function mockWindow(search = "", name = "") {
  const sessionStorage = createStorage()
  const localStorage = createStorage()
  vi.stubGlobal("window", {
    location: { search },
    sessionStorage,
    localStorage,
    name,
  })
  vi.stubGlobal("localStorage", localStorage)
  vi.stubGlobal("sessionStorage", sessionStorage)
}

function snapshot(): WorkspaceLayoutSnapshot {
  return {
    version: 1,
    activeTab: "chat",
    route: "/chat-1",
    activeChat: null,
    activeTopic: null,
    activeSessionKey: null,
    activeSessionTitle: null,
    editorGroups: { groups: [], focusedGroupId: "group-1" },
    splitRatio: 0.5,
    updatedAt: Date.now(),
  }
}

describe("workspace layout persistence", () => {
  beforeEach(async () => {
    mockWindow()
    await persistentCacheClearAll()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps the main window on a scoped main cache key", () => {
    expect(currentWorkspaceLayoutWindowId()).toBe("main")
    expect(workspaceLayoutCacheKey()).toBe("workspace:last-layout:v1:main")
  })

  it("uses a URL-provided id for secondary window cache keys", () => {
    mockWindow("?openclawWindowId=window-test")

    expect(currentWorkspaceLayoutWindowId()).toBe("window-test")
    expect(workspaceLayoutCacheKey()).toBe("workspace:last-layout:v1:window-test")
  })

  it("falls back to the legacy main layout once and migrates it", async () => {
    const legacy = snapshot()
    await persistentCacheSet("workspace:last-layout:v1", legacy)

    const loaded = await loadWorkspaceLayoutSnapshot()

    expect(loaded).toEqual(legacy)
  })
})
