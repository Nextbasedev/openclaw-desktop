import { z } from "zod"
import {
  defineEndpoint,
  gitFileStateSchema,
  nonEmptyStringSchema,
  pathSchema,
  projectIdSchema,
  timestampSchema,
} from "./common"

export const gitFileChangeSchema = z.object({
  path: pathSchema,
  state: gitFileStateSchema,
})

export const gitStatusSchema = z.object({
  branch: nonEmptyStringSchema,
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  changes: z.array(gitFileChangeSchema),
})

export const gitCommitSchema = z.object({
  sha: z.string().min(7),
  title: nonEmptyStringSchema,
  author: nonEmptyStringSchema,
  committedAt: timestampSchema,
})

export const gitDiffSummarySchema = z.object({
  refA: nonEmptyStringSchema,
  refB: nonEmptyStringSchema.optional(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
})

export const gitStatusRequestSchema = z.object({ projectId: projectIdSchema })
export const gitStatusResponseSchema = z.object({ status: gitStatusSchema })

export const gitDiffRequestSchema = z.object({ projectId: projectIdSchema, refA: nonEmptyStringSchema, refB: nonEmptyStringSchema.optional() })
export const gitDiffResponseSchema = z.object({ summary: gitDiffSummarySchema })

export const gitHistoryRequestSchema = z.object({ projectId: projectIdSchema, path: pathSchema.optional() })
export const gitHistoryResponseSchema = z.object({ commits: z.array(gitCommitSchema) })

export const gitBranchesRequestSchema = z.object({ projectId: projectIdSchema })
export const gitBranchesResponseSchema = z.object({ current: nonEmptyStringSchema, branches: z.array(nonEmptyStringSchema) })

export const gitCheckoutRequestSchema = z.object({ projectId: projectIdSchema, branch: nonEmptyStringSchema })
export const gitCheckoutResponseSchema = z.object({ ok: z.literal(true), branch: nonEmptyStringSchema })

export const gitCommitRequestSchema = z.object({ projectId: projectIdSchema, message: nonEmptyStringSchema })
export const gitCommitResponseSchema = z.object({ ok: z.literal(true), commit: gitCommitSchema })

export const gitEndpoints = [
  defineEndpoint({ operationId: "git.status", method: "GET", path: "/api/git/status", request: gitStatusRequestSchema, response: gitStatusResponseSchema }),
  defineEndpoint({ operationId: "git.diff", method: "GET", path: "/api/git/diff", request: gitDiffRequestSchema, response: gitDiffResponseSchema }),
  defineEndpoint({ operationId: "git.history", method: "GET", path: "/api/git/history", request: gitHistoryRequestSchema, response: gitHistoryResponseSchema }),
  defineEndpoint({ operationId: "git.branches", method: "GET", path: "/api/git/branches", request: gitBranchesRequestSchema, response: gitBranchesResponseSchema }),
  defineEndpoint({ operationId: "git.checkout", method: "POST", path: "/api/git/checkout", request: gitCheckoutRequestSchema, response: gitCheckoutResponseSchema }),
  defineEndpoint({ operationId: "git.commit", method: "POST", path: "/api/git/commit", request: gitCommitRequestSchema, response: gitCommitResponseSchema }),
] as const

export type GitFileChange = z.infer<typeof gitFileChangeSchema>
export type GitStatus = z.infer<typeof gitStatusSchema>
export type GitCommit = z.infer<typeof gitCommitSchema>
export type GitDiffSummary = z.infer<typeof gitDiffSummarySchema>
export type GitStatusRequest = z.infer<typeof gitStatusRequestSchema>
export type GitStatusResponse = z.infer<typeof gitStatusResponseSchema>
export type GitDiffRequest = z.infer<typeof gitDiffRequestSchema>
export type GitDiffResponse = z.infer<typeof gitDiffResponseSchema>
export type GitHistoryRequest = z.infer<typeof gitHistoryRequestSchema>
export type GitHistoryResponse = z.infer<typeof gitHistoryResponseSchema>
export type GitBranchesRequest = z.infer<typeof gitBranchesRequestSchema>
export type GitBranchesResponse = z.infer<typeof gitBranchesResponseSchema>
export type GitCheckoutRequest = z.infer<typeof gitCheckoutRequestSchema>
export type GitCheckoutResponse = z.infer<typeof gitCheckoutResponseSchema>
export type GitCommitRequest = z.infer<typeof gitCommitRequestSchema>
export type GitCommitResponse = z.infer<typeof gitCommitResponseSchema>
