"use client"

export type InspectorScope =
  | { kind: "unset" }
  | { kind: "global" }
  | { kind: "project"; projectId: string }

const INSPECTOR_SCOPE_PREFIX = "openclaw.inspectorScope.v1"

export function normalizeInspectorScope(value: unknown): InspectorScope {
  if (!value || typeof value !== "object") return { kind: "unset" }
  const record = value as { kind?: unknown; projectId?: unknown }
  if (record.kind === "global") return { kind: "global" }
  if (record.kind === "project" && typeof record.projectId === "string" && record.projectId.trim()) {
    return { kind: "project", projectId: record.projectId.trim() }
  }
  return { kind: "unset" }
}

export function inspectorScopeStorageKey(sessionKey: string) {
  return `${INSPECTOR_SCOPE_PREFIX}:${encodeURIComponent(sessionKey)}`
}

export function readStoredInspectorScope(sessionKey: string | null | undefined): InspectorScope {
  if (!sessionKey || typeof window === "undefined") return { kind: "unset" }
  try {
    return normalizeInspectorScope(JSON.parse(window.localStorage.getItem(inspectorScopeStorageKey(sessionKey)) ?? "null"))
  } catch {
    return { kind: "unset" }
  }
}

export function writeStoredInspectorScope(sessionKey: string | null | undefined, scope: InspectorScope) {
  if (!sessionKey || typeof window === "undefined") return
  try {
    window.localStorage.setItem(inspectorScopeStorageKey(sessionKey), JSON.stringify(scope))
  } catch {}
}

export function effectiveInspectorScope(projectId: string | null | undefined, stored: InspectorScope): InspectorScope {
  if (projectId?.trim()) return { kind: "project", projectId: projectId.trim() }
  return stored
}

export function inspectorScopeRenderKey(input: {
  sessionKey?: string | null
  projectId?: string | null
  scope: InspectorScope
  windowId?: string | null
}) {
  const projectId = input.projectId?.trim()
  const scopePart = projectId
    ? `project:${projectId}`
    : input.scope.kind === "project"
      ? `project:${input.scope.projectId}`
      : input.scope.kind
  return [
    input.windowId || "main",
    input.sessionKey || "none",
    scopePart,
  ].join(":")
}
