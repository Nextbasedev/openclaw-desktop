import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  pathSchema,
  projectIdSchema,
  timestampSchema,
} from "./common"

export const memoryDocumentSchema = z.object({
  path: pathSchema,
  projectId: projectIdSchema.optional(),
  title: nonEmptyStringSchema.optional(),
  updatedAt: timestampSchema.optional(),
})

export const memorySearchHitSchema = z.object({
  path: pathSchema,
  snippet: nonEmptyStringSchema,
  score: z.number(),
})

export const memoryListRequestSchema = z.object({ projectId: projectIdSchema.optional() }).default({})
export const memoryListResponseSchema = z.object({ documents: z.array(memoryDocumentSchema) })

export const memoryReadRequestSchema = z.object({ path: pathSchema })
export const memoryReadResponseSchema = z.object({ path: pathSchema, content: z.string() })

export const memoryWriteRequestSchema = z.object({ path: pathSchema, content: z.string() })
export const memoryWriteResponseSchema = apiSuccessSchema.extend({ path: pathSchema })

export const memorySearchRequestSchema = z.object({ query: nonEmptyStringSchema })
export const memorySearchResponseSchema = z.object({ hits: z.array(memorySearchHitSchema) })

export const memoryReindexRequestSchema = z.object({}).strict()
export const memoryReindexResponseSchema = apiSuccessSchema.extend({ queued: z.boolean() })

export const memoryEndpoints = [
  defineEndpoint({ operationId: "memory.list", method: "GET", path: "/api/memory", request: memoryListRequestSchema, response: memoryListResponseSchema }),
  defineEndpoint({ operationId: "memory.read", method: "GET", path: "/api/memory/read", request: memoryReadRequestSchema, response: memoryReadResponseSchema }),
  defineEndpoint({ operationId: "memory.write", method: "POST", path: "/api/memory/write", request: memoryWriteRequestSchema, response: memoryWriteResponseSchema }),
  defineEndpoint({ operationId: "memory.search", method: "GET", path: "/api/memory/search", request: memorySearchRequestSchema, response: memorySearchResponseSchema }),
  defineEndpoint({ operationId: "memory.reindex", method: "POST", path: "/api/memory/reindex", request: memoryReindexRequestSchema, response: memoryReindexResponseSchema }),
] as const

export type MemoryDocument = z.infer<typeof memoryDocumentSchema>
export type MemorySearchHit = z.infer<typeof memorySearchHitSchema>
export type MemoryListRequest = z.infer<typeof memoryListRequestSchema>
export type MemoryListResponse = z.infer<typeof memoryListResponseSchema>
export type MemoryReadRequest = z.infer<typeof memoryReadRequestSchema>
export type MemoryReadResponse = z.infer<typeof memoryReadResponseSchema>
export type MemoryWriteRequest = z.infer<typeof memoryWriteRequestSchema>
export type MemoryWriteResponse = z.infer<typeof memoryWriteResponseSchema>
export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>
export type MemorySearchResponse = z.infer<typeof memorySearchResponseSchema>
export type MemoryReindexRequest = z.infer<typeof memoryReindexRequestSchema>
export type MemoryReindexResponse = z.infer<typeof memoryReindexResponseSchema>
