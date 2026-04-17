import { z } from "zod"
import { defineEndpoint, projectIdSchema, topicIdSchema } from "./common"
import { projectSidebarSchema } from "./projects"

export const navigationSidebarRequestSchema = z.object({ projectId: projectIdSchema.optional() }).default({})
export const navigationSidebarResponseSchema = projectSidebarSchema

export const navigationTopicRequestSchema = z.object({ topicId: topicIdSchema })
export const navigationTopicResponseSchema = z.object({ topicId: topicIdSchema, sidebar: projectSidebarSchema })

export const navigationProjectRequestSchema = z.object({ projectId: projectIdSchema })
export const navigationProjectResponseSchema = projectSidebarSchema

export const navigationEndpoints = [
  defineEndpoint({ operationId: "navigation.sidebar", method: "GET", path: "/api/navigation/sidebar", request: navigationSidebarRequestSchema, response: navigationSidebarResponseSchema }),
  defineEndpoint({ operationId: "navigation.topic", method: "GET", path: "/api/navigation/topic/:topicId", request: navigationTopicRequestSchema, response: navigationTopicResponseSchema }),
  defineEndpoint({ operationId: "navigation.project", method: "GET", path: "/api/navigation/project/:projectId", request: navigationProjectRequestSchema, response: navigationProjectResponseSchema }),
] as const

export type NavigationSidebarRequest = z.infer<typeof navigationSidebarRequestSchema>
export type NavigationSidebarResponse = z.infer<typeof navigationSidebarResponseSchema>
export type NavigationTopicRequest = z.infer<typeof navigationTopicRequestSchema>
export type NavigationTopicResponse = z.infer<typeof navigationTopicResponseSchema>
export type NavigationProjectRequest = z.infer<typeof navigationProjectRequestSchema>
export type NavigationProjectResponse = z.infer<typeof navigationProjectResponseSchema>
