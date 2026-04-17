import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  projectIdSchema,
  sessionKeySchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const topicSchema = z.object({
  id: topicIdSchema,
  projectId: projectIdSchema,
  name: nonEmptyStringSchema,
  archived: z.boolean(),
  unreadCount: z.number().int().nonnegative().default(0),
  sortOrder: z.number().int().nonnegative(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const listTopicsRequestSchema = z.object({ projectId: projectIdSchema })
export const listTopicsResponseSchema = z.object({ topics: z.array(topicSchema) })

export const createTopicRequestSchema = z.object({ projectId: projectIdSchema, name: nonEmptyStringSchema })
export const createTopicResponseSchema = z.object({ topic: topicSchema })

export const updateTopicRequestSchema = z.object({
  topicId: topicIdSchema,
  name: nonEmptyStringSchema.optional(),
  sortOrder: z.number().int().nonnegative().optional(),
})
export const updateTopicResponseSchema = z.object({ topic: topicSchema })

export const archiveTopicRequestSchema = z.object({ topicId: topicIdSchema, archived: z.boolean().default(true).optional() })
export const archiveTopicResponseSchema = apiSuccessSchema.extend({ topicId: topicIdSchema, archived: z.boolean() })

export const attachTopicSessionRequestSchema = z.object({ topicId: topicIdSchema, sessionKey: sessionKeySchema })
export const attachTopicSessionResponseSchema = apiSuccessSchema.extend({ topicId: topicIdSchema, sessionKey: sessionKeySchema })

export const detachTopicSessionRequestSchema = z.object({ topicId: topicIdSchema, sessionKey: sessionKeySchema })
export const detachTopicSessionResponseSchema = apiSuccessSchema.extend({ topicId: topicIdSchema, sessionKey: sessionKeySchema })

export const topicEndpoints = [
  defineEndpoint({ operationId: "topics.list", method: "GET", path: "/api/projects/:projectId/topics", request: listTopicsRequestSchema, response: listTopicsResponseSchema }),
  defineEndpoint({ operationId: "topics.create", method: "POST", path: "/api/projects/:projectId/topics", request: createTopicRequestSchema, response: createTopicResponseSchema }),
  defineEndpoint({ operationId: "topics.update", method: "PATCH", path: "/api/topics/:topicId", request: updateTopicRequestSchema, response: updateTopicResponseSchema }),
  defineEndpoint({ operationId: "topics.archive", method: "POST", path: "/api/topics/:topicId/archive", request: archiveTopicRequestSchema, response: archiveTopicResponseSchema }),
  defineEndpoint({ operationId: "topics.attachSession", method: "POST", path: "/api/topics/:topicId/attach-session", request: attachTopicSessionRequestSchema, response: attachTopicSessionResponseSchema }),
  defineEndpoint({ operationId: "topics.detachSession", method: "POST", path: "/api/topics/:topicId/detach-session", request: detachTopicSessionRequestSchema, response: detachTopicSessionResponseSchema }),
] as const

export type Topic = z.infer<typeof topicSchema>

export type ListTopicsRequest = z.infer<typeof listTopicsRequestSchema>
export type ListTopicsResponse = z.infer<typeof listTopicsResponseSchema>
export type CreateTopicRequest = z.infer<typeof createTopicRequestSchema>
export type CreateTopicResponse = z.infer<typeof createTopicResponseSchema>
export type UpdateTopicRequest = z.infer<typeof updateTopicRequestSchema>
export type UpdateTopicResponse = z.infer<typeof updateTopicResponseSchema>
export type ArchiveTopicRequest = z.infer<typeof archiveTopicRequestSchema>
export type ArchiveTopicResponse = z.infer<typeof archiveTopicResponseSchema>
export type AttachTopicSessionRequest = z.infer<typeof attachTopicSessionRequestSchema>
export type AttachTopicSessionResponse = z.infer<typeof attachTopicSessionResponseSchema>
export type DetachTopicSessionRequest = z.infer<typeof detachTopicSessionRequestSchema>
export type DetachTopicSessionResponse = z.infer<typeof detachTopicSessionResponseSchema>
