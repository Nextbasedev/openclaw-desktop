import { z } from "zod"
import {
  bootstrapRunIdSchema,
  bootstrapStatusSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  profileIdSchema,
  timestampSchema,
} from "./common"

export const bootstrapRunSchema = z.object({
  id: bootstrapRunIdSchema,
  profileId: profileIdSchema,
  status: bootstrapStatusSchema,
  summary: z.string().optional(),
  errorSummary: z.string().optional(),
  startedAt: timestampSchema.optional(),
  endedAt: timestampSchema.optional(),
})

export const bootstrapInspectRequestSchema = z.object({ profileId: profileIdSchema })
export const bootstrapInspectResponseSchema = z.object({
  profileId: profileIdSchema,
  openclawInstalled: z.boolean(),
  nodeInstalled: z.boolean(),
  gatewayReachable: z.boolean(),
})

export const bootstrapPlanRequestSchema = z.object({ profileId: profileIdSchema })
export const bootstrapPlanResponseSchema = z.object({
  run: bootstrapRunSchema,
  plannedSteps: z.array(nonEmptyStringSchema),
})

export const bootstrapRunRequestSchema = z.object({ profileId: profileIdSchema })
export const bootstrapRunResponseSchema = z.object({ run: bootstrapRunSchema })

export const bootstrapLogsRequestSchema = z.object({ runId: bootstrapRunIdSchema })
export const bootstrapLogsResponseSchema = z.object({ runId: bootstrapRunIdSchema, lines: z.array(z.string()) })

export const bootstrapEndpoints = [
  defineEndpoint({ operationId: "bootstrap.inspect", method: "GET", path: "/api/bootstrap/inspect", request: bootstrapInspectRequestSchema, response: bootstrapInspectResponseSchema }),
  defineEndpoint({ operationId: "bootstrap.plan", method: "POST", path: "/api/bootstrap/plan", request: bootstrapPlanRequestSchema, response: bootstrapPlanResponseSchema }),
  defineEndpoint({ operationId: "bootstrap.run", method: "POST", path: "/api/bootstrap/run", request: bootstrapRunRequestSchema, response: bootstrapRunResponseSchema }),
  defineEndpoint({ operationId: "bootstrap.logs", method: "GET", path: "/api/bootstrap/logs", request: bootstrapLogsRequestSchema, response: bootstrapLogsResponseSchema }),
] as const

export type BootstrapRun = z.infer<typeof bootstrapRunSchema>
export type BootstrapInspectRequest = z.infer<typeof bootstrapInspectRequestSchema>
export type BootstrapInspectResponse = z.infer<typeof bootstrapInspectResponseSchema>
export type BootstrapPlanRequest = z.infer<typeof bootstrapPlanRequestSchema>
export type BootstrapPlanResponse = z.infer<typeof bootstrapPlanResponseSchema>
export type BootstrapRunRequest = z.infer<typeof bootstrapRunRequestSchema>
export type BootstrapRunResponse = z.infer<typeof bootstrapRunResponseSchema>
export type BootstrapLogsRequest = z.infer<typeof bootstrapLogsRequestSchema>
export type BootstrapLogsResponse = z.infer<typeof bootstrapLogsResponseSchema>
