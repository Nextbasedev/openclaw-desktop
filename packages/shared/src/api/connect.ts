import { z } from "zod"
import { apiSuccessSchema, defineEndpoint, timestampSchema } from "./common"

export const gatewayConnectRequestSchema = z.object({
  url: z.string().min(1),
  token: z.string().min(1),
})

export const gatewayConnectResponseSchema = apiSuccessSchema.extend({
  url: z.string(),
  serverVersion: z.string(),
  agentName: z.string(),
  connectedAt: timestampSchema,
})

export const gatewayConnectSaveRequestSchema = z.object({
  url: z.string().min(1),
  token: z.string().min(1),
})

export const gatewayConnectSaveResponseSchema = apiSuccessSchema.extend({
  url: z.string(),
  port: z.number(),
  savedAt: timestampSchema,
})

export const gatewayConnectStatusRequestSchema = z.object({}).strict()

export const gatewayConnectStatusResponseSchema = z.object({
  configured: z.boolean(),
  url: z.string().optional(),
  port: z.number().optional(),
  reachable: z.boolean().optional(),
})

export const connectEndpoints = [
  defineEndpoint({ operationId: "gateway.connect", method: "POST", path: "/api/gateway/connect", request: gatewayConnectRequestSchema, response: gatewayConnectResponseSchema }),
  defineEndpoint({ operationId: "gateway.connect.save", method: "POST", path: "/api/gateway/connect/save", request: gatewayConnectSaveRequestSchema, response: gatewayConnectSaveResponseSchema }),
  defineEndpoint({ operationId: "gateway.connect.status", method: "GET", path: "/api/gateway/connect/status", request: gatewayConnectStatusRequestSchema, response: gatewayConnectStatusResponseSchema }),
] as const

export type GatewayConnectRequest = z.infer<typeof gatewayConnectRequestSchema>
export type GatewayConnectResponse = z.infer<typeof gatewayConnectResponseSchema>
export type GatewayConnectSaveRequest = z.infer<typeof gatewayConnectSaveRequestSchema>
export type GatewayConnectSaveResponse = z.infer<typeof gatewayConnectSaveResponseSchema>
export type GatewayConnectStatusRequest = z.infer<typeof gatewayConnectStatusRequestSchema>
export type GatewayConnectStatusResponse = z.infer<typeof gatewayConnectStatusResponseSchema>
