import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  emptyRequestSchema,
  nonEmptyStringSchema,
  projectIdSchema,
  sessionKeySchema,
  sessionStatusSchema,
  sessionVisibilitySchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const sessionSchema = z.object({
  key: sessionKeySchema,
  sessionId: z.string().min(1).optional(),
  projectId: projectIdSchema.optional(),
  topicId: topicIdSchema.optional(),
  agentId: z.string().min(1),
  label: nonEmptyStringSchema,
  status: sessionStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  pinned: z.boolean().default(false),
  hidden: z.boolean().default(false),
  source: z.enum(["jarvis", "openclaw-existing"]),
})

export const listSessionsRequestSchema = z.object({
  projectId: projectIdSchema.optional(),
  topicId: topicIdSchema.optional(),
  includeExisting: z.boolean().optional(),
}).default({})
export const listSessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema),
  sessionVisibility: sessionVisibilitySchema,
})

export const createSessionRequestSchema = z.object({
  projectId: projectIdSchema,
  topicId: topicIdSchema.optional(),
  agentId: z.string().min(1),
  label: nonEmptyStringSchema,
})
export const createSessionResponseSchema = z.object({ session: sessionSchema })

export const updateSessionRequestSchema = z.object({
  sessionKey: sessionKeySchema,
  label: nonEmptyStringSchema.optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  topicId: topicIdSchema.nullish(),
})
export const updateSessionResponseSchema = z.object({ session: sessionSchema })

export const resetSessionRequestSchema = z.object({ sessionKey: sessionKeySchema })
export const resetSessionResponseSchema = apiSuccessSchema.extend({ sessionKey: sessionKeySchema })

export const deleteSessionRequestSchema = z.object({ sessionKey: sessionKeySchema })
export const deleteSessionResponseSchema = apiSuccessSchema.extend({ sessionKey: sessionKeySchema })

export const sessionEndpoints = [
  defineEndpoint({ operationId: "sessions.list", method: "GET", path: "/api/sessions", request: listSessionsRequestSchema, response: listSessionsResponseSchema }),
  defineEndpoint({ operationId: "sessions.create", method: "POST", path: "/api/sessions", request: createSessionRequestSchema, response: createSessionResponseSchema }),
  defineEndpoint({ operationId: "sessions.update", method: "PATCH", path: "/api/sessions/:sessionKey", request: updateSessionRequestSchema, response: updateSessionResponseSchema }),
  defineEndpoint({ operationId: "sessions.reset", method: "POST", path: "/api/sessions/:sessionKey/reset", request: resetSessionRequestSchema, response: resetSessionResponseSchema }),
  defineEndpoint({ operationId: "sessions.delete", method: "DELETE", path: "/api/sessions/:sessionKey", request: deleteSessionRequestSchema, response: deleteSessionResponseSchema }),
] as const

export const emptySessionListRequestSchema = emptyRequestSchema
export type MiddlewareSession = z.infer<typeof sessionSchema>

export type ListSessionsRequest = z.infer<typeof listSessionsRequestSchema>
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>
export type UpdateSessionResponse = z.infer<typeof updateSessionResponseSchema>
export type ResetSessionRequest = z.infer<typeof resetSessionRequestSchema>
export type ResetSessionResponse = z.infer<typeof resetSessionResponseSchema>
export type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>
export type DeleteSessionResponse = z.infer<typeof deleteSessionResponseSchema>
