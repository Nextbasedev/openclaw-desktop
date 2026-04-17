import { z } from "zod"
import {
  approvalDecisionSchema,
  approvalIdSchema,
  apiSuccessSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  projectIdSchema,
  sessionKeySchema,
  timestampSchema,
} from "./common"

export const approvalItemSchema = z.object({
  id: approvalIdSchema,
  title: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  commandPreview: z.string().optional(),
  sessionKey: sessionKeySchema.optional(),
  projectId: projectIdSchema.optional(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.optional(),
})

export const approvalsListRequestSchema = z.object({}).strict()
export const approvalsListResponseSchema = z.object({ approvals: z.array(approvalItemSchema) })

export const approvalResolveRequestSchema = z.object({ approvalId: approvalIdSchema, decision: approvalDecisionSchema })
export const approvalResolveResponseSchema = apiSuccessSchema.extend({ approvalId: approvalIdSchema, decision: approvalDecisionSchema })

export const approvalEndpoints = [
  defineEndpoint({ operationId: "approvals.list", method: "GET", path: "/api/approvals", request: approvalsListRequestSchema, response: approvalsListResponseSchema }),
  defineEndpoint({ operationId: "approvals.resolve", method: "POST", path: "/api/approvals/:approvalId", request: approvalResolveRequestSchema, response: approvalResolveResponseSchema }),
] as const

export type ApprovalItem = z.infer<typeof approvalItemSchema>
export type ApprovalsListRequest = z.infer<typeof approvalsListRequestSchema>
export type ApprovalsListResponse = z.infer<typeof approvalsListResponseSchema>
export type ApprovalResolveRequest = z.infer<typeof approvalResolveRequestSchema>
export type ApprovalResolveResponse = z.infer<typeof approvalResolveResponseSchema>
