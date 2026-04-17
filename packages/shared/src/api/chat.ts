import { z } from "zod"
import {
  defineEndpoint,
  nonEmptyStringSchema,
  projectIdSchema,
  sessionKeySchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const contentBlockSchema = z.object({
  type: z.enum(["text", "thinking", "tool_use", "tool_result", "image"]),
  text: z.string().optional(),
  name: z.string().optional(),
  content: z.string().optional(),
  mimeType: z.string().optional(),
})

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  sessionKey: sessionKeySchema,
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
  createdAt: timestampSchema,
  model: z.string().optional(),
})

export const chatHistoryRequestSchema = z.object({ sessionKey: sessionKeySchema })
export const chatHistoryResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  thinkingLevel: z.string().optional(),
  verboseLevel: z.string().optional(),
})

export const chatSendRequestSchema = z.object({
  sessionKey: sessionKeySchema,
  projectId: projectIdSchema.optional(),
  topicId: topicIdSchema.optional(),
  text: nonEmptyStringSchema,
  model: z.string().optional(),
  attachments: z.array(z.object({ name: nonEmptyStringSchema, mimeType: nonEmptyStringSchema })).optional(),
})
export const chatSendResponseSchema = z.object({
  accepted: z.boolean(),
  pendingMessageId: z.string().optional(),
  runId: z.string().optional().nullable(),
  status: z.string().optional(),
  sessionKey: sessionKeySchema.optional(),
})

export const chatAbortRequestSchema = z.object({ sessionKey: sessionKeySchema })
export const chatAbortResponseSchema = z.object({ ok: z.literal(true), sessionKey: sessionKeySchema })

export const chatStreamRequestSchema = z.object({
  sessionKey: sessionKeySchema,
})

export const chatReadyEventSchema = z.object({
  type: z.literal("chat.ready"),
  sessionKey: sessionKeySchema,
  thinkingLevel: z.string().nullable(),
  verboseLevel: z.string().nullable(),
  toolOutputVisibility: z.enum(["hidden", "metadata-only", "full"]),
  recentMessages: z.array(z.object({
    id: z.string().nullable(),
    role: z.string(),
    text: z.string(),
    createdAt: z.string().nullable(),
    model: z.string().nullable(),
  })),
})

export const chatStatusEventSchema = z.object({
  type: z.literal("chat.status"),
  sessionKey: sessionKeySchema,
  state: z.enum(["connected", "sending", "thinking", "tool_running", "streaming", "done", "error"]),
  label: z.string().nullable().optional(),
})

export const chatToolEventSchema = z.object({
  type: z.literal("chat.tool"),
  sessionKey: sessionKeySchema,
  runId: z.string().nullable(),
  verboseLevel: z.string().nullable(),
  toolOutputVisibility: z.enum(["hidden", "metadata-only", "full"]),
  phase: z.string().nullable(),
  name: z.string().nullable(),
  toolCallId: z.string().nullable(),
  args: z.unknown().nullable(),
  partialResult: z.unknown().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
})

export const chatMessageEventSchema = z.object({
  type: z.literal("chat.message"),
  sessionKey: sessionKeySchema,
  messageId: z.string().nullable(),
  role: z.string(),
  content: z.unknown(),
  text: z.string(),
  createdAt: z.string().nullable(),
  model: z.string().nullable(),
})

export const chatErrorEventSchema = z.object({
  type: z.literal("chat.error"),
  sessionKey: sessionKeySchema,
  message: z.string(),
})

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  chatReadyEventSchema,
  chatStatusEventSchema,
  chatToolEventSchema,
  chatMessageEventSchema,
  chatErrorEventSchema,
])

export const chatEndpoints = [
  defineEndpoint({ operationId: "chat.history", method: "GET", path: "/api/chat/history", request: chatHistoryRequestSchema, response: chatHistoryResponseSchema }),
  defineEndpoint({ operationId: "chat.send", method: "POST", path: "/api/chat/send", request: chatSendRequestSchema, response: chatSendResponseSchema }),
  defineEndpoint({ operationId: "chat.abort", method: "POST", path: "/api/chat/abort", request: chatAbortRequestSchema, response: chatAbortResponseSchema }),
  defineEndpoint({ operationId: "chat.stream", method: "GET", path: "/api/chat/stream", request: chatStreamRequestSchema, response: chatStreamEventSchema }),
] as const

export type ChatMessage = z.infer<typeof chatMessageSchema>
export type ChatContentBlock = z.infer<typeof contentBlockSchema>
export type ChatHistoryRequest = z.infer<typeof chatHistoryRequestSchema>
export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>
export type ChatSendRequest = z.infer<typeof chatSendRequestSchema>
export type ChatSendResponse = z.infer<typeof chatSendResponseSchema>
export type ChatAbortRequest = z.infer<typeof chatAbortRequestSchema>
export type ChatAbortResponse = z.infer<typeof chatAbortResponseSchema>
export type ChatStreamRequest = z.infer<typeof chatStreamRequestSchema>
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>
