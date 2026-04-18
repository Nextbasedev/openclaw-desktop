import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  pathSchema,
  projectIdSchema,
  timestampSchema,
} from "./common"

// ── Memory categories (matching Nerve) ──────────────────────────────────────

export const memoryCategorySchema = z.enum(["preference", "fact", "decision", "entity", "other"])
export type MemoryCategory = z.infer<typeof memoryCategorySchema>

// ── Core types ──────────────────────────────────────────────────────────────

export const memoryDocumentSchema = z.object({
  path: pathSchema,
  projectId: projectIdSchema.optional(),
  title: nonEmptyStringSchema.optional(),
  chunkCount: z.number().optional(),
  updatedAt: timestampSchema.optional(),
})

export const memoryChunkSchema = z.object({
  path: pathSchema,
  startLine: z.number(),
  endLine: z.number(),
  source: z.string(),
  snippet: nonEmptyStringSchema,
  score: z.number(),
})

// ── List ────────────────────────────────────────────────────────────────────

export const memoryListRequestSchema = z.object({ projectId: projectIdSchema.optional() }).default({})
export const memoryListResponseSchema = z.object({ documents: z.array(memoryDocumentSchema) })

// ── Read (supports chunk-based line range) ──────────────────────────────────

export const memoryReadRequestSchema = z.object({
  path: pathSchema,
  startLine: z.number().optional(),
  endLine: z.number().optional(),
})
export const memoryReadResponseSchema = z.object({
  path: pathSchema,
  content: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  totalLines: z.number().optional(),
})

// ── Write (with category/importance) ────────────────────────────────────────

export const memoryWriteRequestSchema = z.object({
  path: pathSchema,
  content: z.string(),
  category: memoryCategorySchema.optional(),
  importance: z.number().min(0).max(1).optional(),
})
export const memoryWriteResponseSchema = apiSuccessSchema.extend({
  path: pathSchema,
  category: memoryCategorySchema.nullable().optional(),
  importance: z.number().nullable().optional(),
})

// ── Search (chunk-based results) ────────────────────────────────────────────

export const memorySearchRequestSchema = z.object({
  query: nonEmptyStringSchema,
  limit: z.number().min(1).max(100).optional(),
})
export const memorySearchResponseSchema = z.object({ hits: z.array(memoryChunkSchema) })

// ── Store (Nerve-style dual write) ──────────────────────────────────────────

export const memoryStoreRequestSchema = z.object({
  content: z.string(),
  category: memoryCategorySchema.optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional(),
})
export const memoryStoreResponseSchema = apiSuccessSchema.extend({
  path: pathSchema,
  category: z.string(),
  importance: z.number(),
})

// ── Recall (dreams tracking) ────────────────────────────────────────────────

export const memoryRecallRequestSchema = z.object({
  path: pathSchema.optional(),
  limit: z.number().min(1).max(200).optional(),
})

export const memoryRecallEntrySchema = z.object({
  key: z.string(),
  path: pathSchema,
  startLine: z.number(),
  endLine: z.number(),
  source: z.string(),
  snippet: z.string(),
  recallCount: z.number(),
  totalScore: z.number(),
  maxScore: z.number(),
  firstRecalledAt: z.string().optional(),
  lastRecalledAt: z.string().optional(),
  conceptTags: z.array(z.string()).optional(),
})

export const memoryRecallResponseSchema = z.object({
  entries: z.array(memoryRecallEntrySchema),
  total: z.number(),
  updatedAt: z.string().nullable().optional(),
})

// ── Reindex ─────────────────────────────────────────────────────────────────

export const memoryReindexRequestSchema = z.object({}).strict()
export const memoryReindexResponseSchema = apiSuccessSchema.extend({ queued: z.boolean() })

// ── Endpoint definitions ────────────────────────────────────────────────────

export const memoryEndpoints = [
  defineEndpoint({ operationId: "memory.list", method: "GET", path: "/api/memory", request: memoryListRequestSchema, response: memoryListResponseSchema }),
  defineEndpoint({ operationId: "memory.read", method: "GET", path: "/api/memory/read", request: memoryReadRequestSchema, response: memoryReadResponseSchema }),
  defineEndpoint({ operationId: "memory.write", method: "POST", path: "/api/memory/write", request: memoryWriteRequestSchema, response: memoryWriteResponseSchema }),
  defineEndpoint({ operationId: "memory.search", method: "GET", path: "/api/memory/search", request: memorySearchRequestSchema, response: memorySearchResponseSchema }),
  defineEndpoint({ operationId: "memory.store", method: "POST", path: "/api/memory/store", request: memoryStoreRequestSchema, response: memoryStoreResponseSchema }),
  defineEndpoint({ operationId: "memory.recall", method: "GET", path: "/api/memory/recall", request: memoryRecallRequestSchema, response: memoryRecallResponseSchema }),
  defineEndpoint({ operationId: "memory.reindex", method: "POST", path: "/api/memory/reindex", request: memoryReindexRequestSchema, response: memoryReindexResponseSchema }),
] as const

// ── Type exports ────────────────────────────────────────────────────────────

export type MemoryDocument = z.infer<typeof memoryDocumentSchema>
export type MemoryChunk = z.infer<typeof memoryChunkSchema>
export type MemoryRecallEntry = z.infer<typeof memoryRecallEntrySchema>
export type MemoryListRequest = z.infer<typeof memoryListRequestSchema>
export type MemoryListResponse = z.infer<typeof memoryListResponseSchema>
export type MemoryReadRequest = z.infer<typeof memoryReadRequestSchema>
export type MemoryReadResponse = z.infer<typeof memoryReadResponseSchema>
export type MemoryWriteRequest = z.infer<typeof memoryWriteRequestSchema>
export type MemoryWriteResponse = z.infer<typeof memoryWriteResponseSchema>
export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>
export type MemorySearchResponse = z.infer<typeof memorySearchResponseSchema>
export type MemoryStoreRequest = z.infer<typeof memoryStoreRequestSchema>
export type MemoryStoreResponse = z.infer<typeof memoryStoreResponseSchema>
export type MemoryRecallRequest = z.infer<typeof memoryRecallRequestSchema>
export type MemoryRecallResponse = z.infer<typeof memoryRecallResponseSchema>
export type MemoryReindexRequest = z.infer<typeof memoryReindexRequestSchema>
export type MemoryReindexResponse = z.infer<typeof memoryReindexResponseSchema>
