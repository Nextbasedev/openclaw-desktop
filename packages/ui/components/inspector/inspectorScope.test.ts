import { describe, expect, it, beforeEach, vi } from "vitest"
import {
  effectiveInspectorScope,
  inspectorScopeRenderKey,
  inspectorScopeStorageKey,
  readStoredInspectorScope,
  writeStoredInspectorScope,
} from "./inspectorScope"

describe("inspector scope", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    const store = new Map<string, string>()
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
      },
    })
  })

  it("lets active project scope win over stored direct-chat scope", () => {
    expect(effectiveInspectorScope("project-1", { kind: "global" })).toEqual({
      kind: "project",
      projectId: "project-1",
    })
  })

  it("returns unset for direct chats without stored scope", () => {
    expect(readStoredInspectorScope("session-a")).toEqual({ kind: "unset" })
  })

  it("persists global scope under the session key", () => {
    writeStoredInspectorScope("session-a", { kind: "global" })
    expect(readStoredInspectorScope("session-a")).toEqual({ kind: "global" })
    expect(readStoredInspectorScope("session-b")).toEqual({ kind: "unset" })
  })

  it("persists project scope under the session key", () => {
    writeStoredInspectorScope("session-a", { kind: "project", projectId: "project-2" })
    expect(readStoredInspectorScope("session-a")).toEqual({ kind: "project", projectId: "project-2" })
  })

  it("uses different storage and render keys for different direct chats", () => {
    expect(inspectorScopeStorageKey("session-a")).not.toEqual(inspectorScopeStorageKey("session-b"))
    expect(inspectorScopeRenderKey({ sessionKey: "session-a", scope: { kind: "global" } })).not.toEqual(
      inspectorScopeRenderKey({ sessionKey: "session-b", scope: { kind: "global" } }),
    )
  })
})
