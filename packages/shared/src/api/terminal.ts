import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  projectIdSchema,
  terminalIdSchema,
  terminalStatusSchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const terminalSessionSchema = z.object({
  id: terminalIdSchema,
  projectId: projectIdSchema,
  topicId: topicIdSchema.optional(),
  title: nonEmptyStringSchema,
  cwd: z.string().min(1),
  status: terminalStatusSchema,
  lastActiveAt: timestampSchema,
  runtimeId: z.string().min(1).optional(),
})

export const terminalCreateRequestSchema = z.object({
  projectId: projectIdSchema,
  topicId: topicIdSchema.optional(),
  cwd: z.string().min(1).optional(),
  title: nonEmptyStringSchema.optional(),
})
export const terminalCreateResponseSchema = z.object({ terminal: terminalSessionSchema })

export const terminalWriteRequestSchema = z.object({ sessionId: terminalIdSchema, data: z.string() })
export const terminalWriteResponseSchema = apiSuccessSchema.extend({ sessionId: terminalIdSchema })

export const terminalResizeRequestSchema = z.object({ sessionId: terminalIdSchema, cols: z.number().int().positive(), rows: z.number().int().positive() })
export const terminalResizeResponseSchema = apiSuccessSchema.extend({ sessionId: terminalIdSchema })

export const terminalCloseRequestSchema = z.object({ sessionId: terminalIdSchema })
export const terminalCloseResponseSchema = apiSuccessSchema.extend({ sessionId: terminalIdSchema })

export const terminalListRequestSchema = z.object({ projectId: projectIdSchema })
export const terminalListResponseSchema = z.object({ terminals: z.array(terminalSessionSchema) })

export const terminalEndpoints = [
  defineEndpoint({ operationId: "terminal.create", method: "POST", path: "/api/terminal", request: terminalCreateRequestSchema, response: terminalCreateResponseSchema }),
  defineEndpoint({ operationId: "terminal.write", method: "POST", path: "/api/terminal/:sessionId/write", request: terminalWriteRequestSchema, response: terminalWriteResponseSchema }),
  defineEndpoint({ operationId: "terminal.resize", method: "POST", path: "/api/terminal/:sessionId/resize", request: terminalResizeRequestSchema, response: terminalResizeResponseSchema }),
  defineEndpoint({ operationId: "terminal.close", method: "POST", path: "/api/terminal/:sessionId/close", request: terminalCloseRequestSchema, response: terminalCloseResponseSchema }),
  defineEndpoint({ operationId: "terminal.list", method: "GET", path: "/api/terminal", request: terminalListRequestSchema, response: terminalListResponseSchema }),
] as const

export type TerminalSession = z.infer<typeof terminalSessionSchema>

export type TerminalCreateRequest = z.infer<typeof terminalCreateRequestSchema>
export type TerminalCreateResponse = z.infer<typeof terminalCreateResponseSchema>
export type TerminalWriteRequest = z.infer<typeof terminalWriteRequestSchema>
export type TerminalWriteResponse = z.infer<typeof terminalWriteResponseSchema>
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>
export type TerminalResizeResponse = z.infer<typeof terminalResizeResponseSchema>
export type TerminalCloseRequest = z.infer<typeof terminalCloseRequestSchema>
export type TerminalCloseResponse = z.infer<typeof terminalCloseResponseSchema>
export type TerminalListRequest = z.infer<typeof terminalListRequestSchema>
export type TerminalListResponse = z.infer<typeof terminalListResponseSchema>
