"use client"

// ── Inspector scope model ──
// Every visible chat/session has one inspector scope that controls
// both Workspace and Git tabs.
//
// Rules:
// - Topic/project chat: effective scope is always { kind: "project", projectId }.
// - Direct chat with stored scope: use stored scope.
// - Direct chat without stored scope: show picker (kind: "unset").
// - "global" is an explicit user choice, not a silent fallback.
// - Workspace and Git read the same scope.

export type InspectorScope =
  | { kind: "unset" }
  | { kind: "global" }
  | { kind: "project"; projectId: string }

const INSPECTOR_SCOPE_PREFIX = "openclaw.inspectorScope.v1"

/** Normalize unknown values into a valid InspectorScope */
export function normalizeInspectorScope(value: unknown): InspectorScope {
  if (!value || typeof value !== "object") return { kind: "unset" }
  const record = value as { kind?: unknown; projectId?: unknown }
  if (record.kind === "global") return { kind: "global" }
  if (record.kind === "project" && typeof record.projectId === "string" && record.projectId.trim()) {
    return { kind: "project", projectId: record.projectId.trim() }
  }
  return { kind: "unset" }
}

/** localStorage key for a specific direct-chat session */
export function inspectorScopeStorageKey(sessionKey: string) {
  return `${INSPECTOR_SCOPE_PREFIX}:${encodeURIComponent(sessionKey)}`
}

/** Read stored scope for a direct chat. Returns "unset" if nothing stored. */
export function readStoredInspectorScope(sessionKey: string | null | undefined): InspectorScope {
  if (!sessionKey || typeof window === "undefined") return { kind: "unset" }
  try {
    return normalizeInspectorScope(JSON.parse(window.localStorage.getItem(inspectorScopeStorageKey(sessionKey)) ?? "null"))
  } catch {
    return { kind: "unset" }
  }
}

/** Persist scope for a direct chat */
export function writeStoredInspectorScope(sessionKey: string | null | undefined, scope: InspectorScope) {
  if (!sessionKey || typeof window === "undefined") return
  try {
    window.localStorage.setItem(inspectorScopeStorageKey(sessionKey), JSON.stringify(scope))
  } catch {}
}

/** Project route scope always wins over stored direct-chat scope */
export function effectiveInspectorScope(projectId: string | null | undefined, stored: InspectorScope): InspectorScope {
  if (projectId?.trim()) return { kind: "project", projectId: projectId.trim() }
  return stored
}

/** Extract projectId from scope, or null */
export function inspectorScopeProjectId(scope: InspectorScope): string | null {
  return scope.kind === "project" ? scope.projectId : null
}

/** Build a unique render/cache key from scope + session */
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
  return [input.windowId || "main", input.sessionKey || "none", scopePart].join(":")
}
