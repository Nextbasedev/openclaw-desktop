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
