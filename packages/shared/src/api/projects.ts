import { z } from "zod"
import {
  apiSuccessSchema,
  agentStatusSchema,
  defineEndpoint,
  emptyRequestSchema,
  nonEmptyStringSchema,
  pathSchema,
  profileIdSchema,
  projectIdSchema,
  sessionStatusSchema,
  sessionVisibilitySchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const projectSchema = z.object({
  id: projectIdSchema,
  name: nonEmptyStringSchema,
  profileId: profileIdSchema,
  workspaceRoot: pathSchema,
  repoRoot: pathSchema.optional(),
  archived: z.boolean(),
  pinned: z.boolean().default(false),
  unreadCount: z.number().int().nonnegative().default(0),
  lastActivityAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const projectRepoSummarySchema = z.object({
  branch: nonEmptyStringSchema,
  dirty: z.boolean(),
})

export const sidebarAgentSchema = z.object({
  id: z.string().min(1),
  name: nonEmptyStringSchema,
  status: agentStatusSchema,
})

export const sidebarSessionSchema = z.object({
  key: z.string().min(1),
  title: nonEmptyStringSchema,
  status: sessionStatusSchema,
})

export const sidebarTopicSchema = z.object({
  id: topicIdSchema,
  name: nonEmptyStringSchema,
  unreadCount: z.number().int().nonnegative(),
})

export const projectSidebarSchema = z.object({
  project: z.object({
    id: projectIdSchema,
    name: nonEmptyStringSchema,
  }),
  topics: z.array(sidebarTopicSchema),
  agents: z.array(sidebarAgentSchema),
  sessions: z.array(sidebarSessionSchema),
  sessionVisibility: sessionVisibilitySchema,
})

export const listProjectsRequestSchema = emptyRequestSchema
export const listProjectsResponseSchema = z.object({ projects: z.array(projectSchema) })

export const createProjectRequestSchema = z.object({
  name: nonEmptyStringSchema,
  profileId: profileIdSchema,
  workspaceRoot: pathSchema,
  repoRoot: pathSchema.optional(),
})
export const createProjectResponseSchema = z.object({ project: projectSchema })

export const getProjectRequestSchema = z.object({ projectId: projectIdSchema })
export const getProjectResponseSchema = z.object({ project: projectSchema.extend({ repo: projectRepoSummarySchema.optional() }) })

export const updateProjectRequestSchema = z.object({
  projectId: projectIdSchema,
  name: nonEmptyStringSchema.optional(),
  workspaceRoot: pathSchema.optional(),
  repoRoot: pathSchema.optional(),
  archived: z.boolean().optional(),
})
export const updateProjectResponseSchema = z.object({ project: projectSchema })

export const archiveProjectRequestSchema = z.object({ projectId: projectIdSchema, archived: z.boolean().default(true).optional() })
export const archiveProjectResponseSchema = apiSuccessSchema.extend({ projectId: projectIdSchema, archived: z.boolean() })

export const pinProjectRequestSchema = z.object({ projectId: projectIdSchema, pinned: z.boolean().default(true).optional() })
export const pinProjectResponseSchema = apiSuccessSchema.extend({ projectId: projectIdSchema, pinned: z.boolean() })

export const deleteProjectRequestSchema = z.object({ projectId: projectIdSchema })
export const deleteProjectResponseSchema = apiSuccessSchema.extend({ projectId: projectIdSchema })

export const projectSidebarRequestSchema = z.object({ projectId: projectIdSchema })
export const projectSidebarResponseSchema = projectSidebarSchema

export const projectEndpoints = [
  defineEndpoint({ operationId: "projects.list", method: "GET", path: "/api/projects", request: listProjectsRequestSchema, response: listProjectsResponseSchema }),
  defineEndpoint({ operationId: "projects.create", method: "POST", path: "/api/projects", request: createProjectRequestSchema, response: createProjectResponseSchema }),
  defineEndpoint({ operationId: "projects.get", method: "GET", path: "/api/projects/:projectId", request: getProjectRequestSchema, response: getProjectResponseSchema }),
  defineEndpoint({ operationId: "projects.update", method: "PATCH", path: "/api/projects/:projectId", request: updateProjectRequestSchema, response: updateProjectResponseSchema }),
  defineEndpoint({ operationId: "projects.archive", method: "POST", path: "/api/projects/:projectId/archive", request: archiveProjectRequestSchema, response: archiveProjectResponseSchema }),
  defineEndpoint({ operationId: "projects.pin", method: "POST", path: "/api/projects/:projectId/pin", request: pinProjectRequestSchema, response: pinProjectResponseSchema }),
  defineEndpoint({ operationId: "projects.delete", method: "DELETE", path: "/api/projects/:projectId", request: deleteProjectRequestSchema, response: deleteProjectResponseSchema }),
  defineEndpoint({ operationId: "projects.sidebar", method: "GET", path: "/api/projects/:projectId/sidebar", request: projectSidebarRequestSchema, response: projectSidebarResponseSchema }),
] as const

export type Project = z.infer<typeof projectSchema>
export type ProjectSidebar = z.infer<typeof projectSidebarSchema>

export type ProjectRepoSummary = z.infer<typeof projectRepoSummarySchema>
export type ListProjectsRequest = z.infer<typeof listProjectsRequestSchema>
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>
export type GetProjectRequest = z.infer<typeof getProjectRequestSchema>
export type GetProjectResponse = z.infer<typeof getProjectResponseSchema>
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>
export type UpdateProjectResponse = z.infer<typeof updateProjectResponseSchema>
export type ArchiveProjectRequest = z.infer<typeof archiveProjectRequestSchema>
export type ArchiveProjectResponse = z.infer<typeof archiveProjectResponseSchema>
export type PinProjectRequest = z.infer<typeof pinProjectRequestSchema>
export type PinProjectResponse = z.infer<typeof pinProjectResponseSchema>
export type DeleteProjectRequest = z.infer<typeof deleteProjectRequestSchema>
export type DeleteProjectResponse = z.infer<typeof deleteProjectResponseSchema>
export type ProjectSidebarRequest = z.infer<typeof projectSidebarRequestSchema>
export type ProjectSidebarResponse = z.infer<typeof projectSidebarResponseSchema>
