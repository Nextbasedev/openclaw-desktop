import { describe, expect, it, beforeEach, vi, afterEach } from "vitest"
import {
  effectiveInspectorScope,
  inspectorScopeRenderKey,
  inspectorScopeStorageKey,
  inspectorScopeProjectId,
  normalizeInspectorScope,
  readStoredInspectorScope,
  writeStoredInspectorScope,
} from "./inspectorScope"

// Mock window.localStorage for node environment
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => { store.clear() },
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

describe("inspectorScope", () => {
  beforeEach(() => {
    store.clear()
    ;(globalThis as Record<string, unknown>).window = { localStorage: mockLocalStorage }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  it("normalizes invalid values to unset", () => {
    expect(normalizeInspectorScope(null)).toEqual({ kind: "unset" })
    expect(normalizeInspectorScope(undefined)).toEqual({ kind: "unset" })
    expect(normalizeInspectorScope("bogus")).toEqual({ kind: "unset" })
    expect(normalizeInspectorScope({ kind: "project", projectId: "" })).toEqual({ kind: "unset" })
    expect(normalizeInspectorScope({ kind: "project", projectId: "  " })).toEqual({ kind: "unset" })
  })

  it("normalizes valid scopes", () => {
    expect(normalizeInspectorScope({ kind: "global" })).toEqual({ kind: "global" })
    expect(normalizeInspectorScope({ kind: "project", projectId: " project_a " })).toEqual({ kind: "project", projectId: "project_a" })
  })

  it("stores scope per direct chat session key", () => {
    writeStoredInspectorScope("chat-a", { kind: "global" })
    writeStoredInspectorScope("chat-b", { kind: "project", projectId: "project_b" })

    expect(readStoredInspectorScope("chat-a")).toEqual({ kind: "global" })
    expect(readStoredInspectorScope("chat-b")).toEqual({ kind: "project", projectId: "project_b" })
    expect(readStoredInspectorScope("chat-c")).toEqual({ kind: "unset" })
    expect(readStoredInspectorScope(null)).toEqual({ kind: "unset" })
    expect(store.get(inspectorScopeStorageKey("chat-a"))).toBe(JSON.stringify({ kind: "global" }))
  })

  it("lets project/topic route scope override stored direct chat scope", () => {
    expect(effectiveInspectorScope("project_route", { kind: "global" })).toEqual({ kind: "project", projectId: "project_route" })
    expect(effectiveInspectorScope(null, { kind: "global" })).toEqual({ kind: "global" })
    expect(effectiveInspectorScope("  ", { kind: "project", projectId: "p1" })).toEqual({ kind: "project", projectId: "p1" })
  })

  it("extracts projectId from scope", () => {
    expect(inspectorScopeProjectId({ kind: "unset" })).toBeNull()
    expect(inspectorScopeProjectId({ kind: "global" })).toBeNull()
    expect(inspectorScopeProjectId({ kind: "project", projectId: "p1" })).toBe("p1")
  })

  it("includes session key in render/cache keys for isolation", () => {
    const a = inspectorScopeRenderKey({ sessionKey: "a", scope: { kind: "global" } })
    const b = inspectorScopeRenderKey({ sessionKey: "b", scope: { kind: "global" } })
    expect(a).not.toEqual(b)
    expect(a).toContain("a")
    expect(b).toContain("b")
  })

  it("includes scope kind in render key", () => {
    const global = inspectorScopeRenderKey({ sessionKey: "x", scope: { kind: "global" } })
    const project = inspectorScopeRenderKey({ sessionKey: "x", scope: { kind: "project", projectId: "p1" } })
    expect(global).toContain("global")
    expect(project).toContain("project:p1")
  })
})
