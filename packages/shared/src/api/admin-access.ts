import { z } from "zod"

import { defineEndpoint, nonEmptyStringSchema } from "./common"

export const adminAccessActionIdSchema = z.enum(["sessions.patch", "sessions.reset", "sessions.delete", "settings.schema"])
export const adminAccessStatusSchema = z.enum(["needs_admin", "approved"])

export const adminAccessApproverSchema = z.object({
  id: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  role: nonEmptyStringSchema,
})

export const adminAccessRetrySchema = z.object({
  gatewayMethod: adminAccessActionIdSchema,
  label: nonEmptyStringSchema.optional(),
  openClawFlow: z.array(nonEmptyStringSchema).optional(),
})

export const adminAccessRequestRequestSchema = z.object({
  actionId: adminAccessActionIdSchema,
  actionLabel: nonEmptyStringSchema.optional(),
})

export const adminAccessRequestResponseSchema = z.object({
  status: z.literal("needs_admin"),
  title: nonEmptyStringSchema,
  message: nonEmptyStringSchema,
  primaryActionLabel: nonEmptyStringSchema,
  secondaryActionLabel: nonEmptyStringSchema,
  requestPath: z.literal("/api/admin-access/approve"),
  showApproverPickerByDefault: z.boolean(),
  recommendedApprovers: z.array(adminAccessApproverSchema),
  retry: adminAccessRetrySchema.extend({
    label: nonEmptyStringSchema,
  }),
})

export const adminAccessApproveRequestSchema = z.object({
  actionId: adminAccessActionIdSchema,
})

export const adminAccessApproveResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("approved"),
    approved: z.literal(true),
    retry: adminAccessRetrySchema.extend({
      openClawFlow: z.array(nonEmptyStringSchema),
    }),
    message: nonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("needs_admin"),
    approved: z.literal(false),
    retry: adminAccessRetrySchema.extend({
      openClawFlow: z.array(nonEmptyStringSchema),
    }),
    message: nonEmptyStringSchema,
    error: z.object({
      code: nonEmptyStringSchema,
      message: nonEmptyStringSchema,
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
])

export const adminAccessEndpoints = [
  defineEndpoint({
    operationId: "admin-access.request",
    method: "POST",
    path: "/api/admin-access/request",
    request: adminAccessRequestRequestSchema,
    response: adminAccessRequestResponseSchema,
  }),
  defineEndpoint({
    operationId: "admin-access.approve",
    method: "POST",
    path: "/api/admin-access/approve",
    request: adminAccessApproveRequestSchema,
    response: adminAccessApproveResponseSchema,
  }),
] as const

export type AdminAccessActionId = z.infer<typeof adminAccessActionIdSchema>
export type AdminAccessStatus = z.infer<typeof adminAccessStatusSchema>
export type AdminAccessApprover = z.infer<typeof adminAccessApproverSchema>
export type AdminAccessRetry = z.infer<typeof adminAccessRetrySchema>
export type AdminAccessRequestRequest = z.infer<typeof adminAccessRequestRequestSchema>
export type AdminAccessRequestResponse = z.infer<typeof adminAccessRequestResponseSchema>
export type AdminAccessApproveRequest = z.infer<typeof adminAccessApproveRequestSchema>
export type AdminAccessApproveResponse = z.infer<typeof adminAccessApproveResponseSchema>
