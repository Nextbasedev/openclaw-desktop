import { invoke } from "@/lib/ipc"

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
  return invoke<ProjectListResponse>("middleware_projects_list", {
    input: {},
  })
}

export async function archiveProject(
  projectId: string,
  archived = true,
): Promise<{ ok: boolean; projectId: string; archived: boolean }> {
  return invoke("middleware_projects_archive", {
    input: { projectId, archived },
  })
}
