"use client"

import { invoke } from "@tauri-apps/api/core"

export type Project = {
  id: string
  name: string
  profileId: string
  workspaceRoot: string
  repoRoot: string | null
  archived: boolean
  unreadCount: number
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
}

export type Topic = {
  id: string
  projectId: string
  name: string
  archived: boolean
  unreadCount: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type SessionMapping = {
  sessionKey: string
  sessionId: string | null
  projectId: string | null
  topicId: string | null
  agentId: string
  label: string | null
  status: string
  createdAt: string
  updatedAt: string
  pinned: boolean
  hidden: boolean
  source: string
}

export type ProjectSidebarPayload = {
  project: { id: string; name: string }
  topics: Array<{ id: string; name: string; unreadCount: number }>
  agents: Array<{ id: string; name: string; status: string }>
  sessions: Array<{ key: string; title: string | null; status: string | null }>
  sessionVisibility: string
}

export async function listProjects() {
  return invoke<{ projects: Project[] }>("middleware_projects_list")
}

export async function createProject(input: {
  name: string
  profileId: string
  workspaceRoot: string
  repoRoot?: string
}) {
  return invoke<{ project: Project }>("middleware_projects_create", { input })
}

export async function updateProject(input: {
  projectId: string
  name?: string
  workspaceRoot?: string
  repoRoot?: string
  archived?: boolean
}) {
  return invoke<{ project: Project }>("middleware_projects_update", { input })
}

export async function archiveProject(projectId: string, archived = true) {
  return invoke<{ ok: boolean; projectId: string; archived: boolean }>("middleware_projects_archive", {
    input: { projectId, archived },
  })
}

export async function getProjectSidebar(projectId: string) {
  return invoke<ProjectSidebarPayload>("middleware_projects_sidebar", {
    input: { projectId },
  })
}

export async function listTopics(projectId: string) {
  return invoke<{ topics: Topic[] }>("middleware_topics_list", {
    input: { projectId },
  })
}

export async function createTopic(input: {
  projectId: string
  name: string
}) {
  return invoke<{ topic: Topic }>("middleware_topics_create", { input })
}

export async function updateTopic(input: {
  topicId: string
  name?: string
  sortOrder?: number
}) {
  return invoke<{ topic: Topic }>("middleware_topics_update", { input })
}

export async function archiveTopic(topicId: string, archived = true) {
  return invoke<{ ok: boolean; topicId: string; archived: boolean }>("middleware_topics_archive", {
    input: { topicId, archived },
  })
}

export async function attachSessionToTopic(topicId: string, sessionKey: string) {
  return invoke<{ ok: boolean; topicId: string; sessionKey: string }>("middleware_topics_attach_session", {
    input: { topicId, sessionKey },
  })
}

export async function detachSessionFromTopic(topicId: string, sessionKey: string) {
  return invoke<{ ok: boolean; topicId: string; sessionKey: string }>("middleware_topics_detach_session", {
    input: { topicId, sessionKey },
  })
}

export async function listSessions(input?: {
  projectId?: string
  topicId?: string
  includeExisting?: boolean
}) {
  return invoke<{ sessions: SessionMapping[] }>("middleware_sessions_list", {
    input: input ?? null,
  })
}

export async function createSessionMapping(input: {
  projectId: string
  topicId: string
  agentId: string
  label: string
}) {
  return invoke<{ session: SessionMapping }>("middleware_sessions_create", { input })
}

export async function updateSessionMapping(input: {
  sessionKey: string
  label?: string
  pinned?: boolean
  hidden?: boolean
  topicId?: string | null
}) {
  return invoke<{ session: SessionMapping }>("middleware_sessions_update", { input })
}

export async function deleteSessionMapping(sessionKey: string) {
  return invoke<{ ok: boolean; sessionKey: string }>("middleware_sessions_delete", {
    input: { sessionKey },
  })
}
