import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  fileNodeTypeSchema,
  nonEmptyStringSchema,
  pathSchema,
  projectIdSchema,
  timestampSchema,
} from "./common"

export const fileNodeSchema = z.object({
  name: nonEmptyStringSchema,
  path: pathSchema,
  type: fileNodeTypeSchema,
  size: z.number().int().nonnegative().optional(),
  modifiedAt: timestampSchema.optional(),
})

export const fileDocumentSchema = z.object({
  path: pathSchema,
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
})

export const fileTreeRequestSchema = z.object({ projectId: projectIdSchema, path: pathSchema.default("/") })
export const fileTreeResponseSchema = z.object({ nodes: z.array(fileNodeSchema) })

export const fileReadRequestSchema = z.object({ projectId: projectIdSchema, path: pathSchema })
export const fileReadResponseSchema = z.object({ file: fileDocumentSchema })

export const fileWriteRequestSchema = z.object({ projectId: projectIdSchema, path: pathSchema, content: z.string() })
export const fileWriteResponseSchema = apiSuccessSchema.extend({ path: pathSchema })

export const fileMkdirRequestSchema = z.object({ projectId: projectIdSchema, path: pathSchema })
export const fileMkdirResponseSchema = apiSuccessSchema.extend({ path: pathSchema })

export const fileRenameRequestSchema = z.object({ projectId: projectIdSchema, from: pathSchema, to: pathSchema })
export const fileRenameResponseSchema = apiSuccessSchema.extend({ from: pathSchema, to: pathSchema })

export const fileDeleteRequestSchema = z.object({ projectId: projectIdSchema, path: pathSchema })
export const fileDeleteResponseSchema = apiSuccessSchema.extend({ path: pathSchema })

export const fileSearchRequestSchema = z.object({ projectId: projectIdSchema, query: nonEmptyStringSchema })
export const fileSearchResponseSchema = z.object({ results: z.array(fileNodeSchema) })

export const fileEndpoints = [
  defineEndpoint({ operationId: "files.tree", method: "GET", path: "/api/files/tree", request: fileTreeRequestSchema, response: fileTreeResponseSchema }),
  defineEndpoint({ operationId: "files.read", method: "GET", path: "/api/files/read", request: fileReadRequestSchema, response: fileReadResponseSchema }),
  defineEndpoint({ operationId: "files.write", method: "POST", path: "/api/files/write", request: fileWriteRequestSchema, response: fileWriteResponseSchema }),
  defineEndpoint({ operationId: "files.mkdir", method: "POST", path: "/api/files/mkdir", request: fileMkdirRequestSchema, response: fileMkdirResponseSchema }),
  defineEndpoint({ operationId: "files.rename", method: "POST", path: "/api/files/rename", request: fileRenameRequestSchema, response: fileRenameResponseSchema }),
  defineEndpoint({ operationId: "files.delete", method: "POST", path: "/api/files/delete", request: fileDeleteRequestSchema, response: fileDeleteResponseSchema }),
  defineEndpoint({ operationId: "files.search", method: "GET", path: "/api/files/search", request: fileSearchRequestSchema, response: fileSearchResponseSchema }),
] as const

export type FileNode = z.infer<typeof fileNodeSchema>
export type FileDocument = z.infer<typeof fileDocumentSchema>

export type FileTreeRequest = z.infer<typeof fileTreeRequestSchema>
export type FileTreeResponse = z.infer<typeof fileTreeResponseSchema>
export type FileReadRequest = z.infer<typeof fileReadRequestSchema>
export type FileReadResponse = z.infer<typeof fileReadResponseSchema>
export type FileWriteRequest = z.infer<typeof fileWriteRequestSchema>
export type FileWriteResponse = z.infer<typeof fileWriteResponseSchema>
export type FileMkdirRequest = z.infer<typeof fileMkdirRequestSchema>
export type FileMkdirResponse = z.infer<typeof fileMkdirResponseSchema>
export type FileRenameRequest = z.infer<typeof fileRenameRequestSchema>
export type FileRenameResponse = z.infer<typeof fileRenameResponseSchema>
export type FileDeleteRequest = z.infer<typeof fileDeleteRequestSchema>
export type FileDeleteResponse = z.infer<typeof fileDeleteResponseSchema>
export type FileSearchRequest = z.infer<typeof fileSearchRequestSchema>
export type FileSearchResponse = z.infer<typeof fileSearchResponseSchema>
