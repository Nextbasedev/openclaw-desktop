import { tauriInvoke } from "@/lib/tauri"

export type Project = {
  id: string
  name: string
  profileId: string
  workspaceRoot: string
  repoRoot: string | null
  archived: boolean
  pinned: boolean
  unreadCount: number
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
}

export type ProjectListResponse = {
  projects: Project[]
}

export async function fetchProjects(): Promise<ProjectListResponse> {
  return tauriInvoke<ProjectListResponse>("middleware_projects_list", {
    input: {},
  })
}
