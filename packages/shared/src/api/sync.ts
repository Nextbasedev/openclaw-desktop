import { z } from "zod"
import { apiSuccessSchema, defineEndpoint, nonEmptyStringSchema, timestampSchema } from "./common"

export const syncDeviceSchema = z.object({
  deviceId: nonEmptyStringSchema,
  deviceName: nonEmptyStringSchema,
  lastSeen: timestampSchema,
})

export const syncStatusSchema = z.object({
  enabled: z.boolean(),
  deviceId: nonEmptyStringSchema.optional(),
  deviceName: nonEmptyStringSchema.optional(),
  lastSyncAt: timestampSchema.optional(),
  dirtyCount: z.number().int().nonnegative(),
})

export const syncResultSchema = apiSuccessSchema.extend({
  pulled: z.number().int().nonnegative(),
  pushed: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
})

export const syncEnableRequestSchema = z.object({
  enabled: z.boolean(),
  deviceName: nonEmptyStringSchema.optional(),
})

export const syncFullRequestSchema = z.object({
  profileId: nonEmptyStringSchema,
})

export const syncDevicesRequestSchema = z.object({
  profileId: nonEmptyStringSchema,
})

export const syncDevicesResponseSchema = z.object({
  devices: z.array(syncDeviceSchema),
})

export const syncEndpoints = [
  defineEndpoint({ operationId: "sync.full", method: "POST", path: "/api/sync/full", request: syncFullRequestSchema, response: syncResultSchema }),
  defineEndpoint({ operationId: "sync.status", method: "GET", path: "/api/sync/status", request: z.object({}).default({}), response: syncStatusSchema }),
  defineEndpoint({ operationId: "sync.enable", method: "POST", path: "/api/sync/enable", request: syncEnableRequestSchema, response: apiSuccessSchema }),
  defineEndpoint({ operationId: "sync.devices", method: "GET", path: "/api/sync/devices", request: syncDevicesRequestSchema, response: syncDevicesResponseSchema }),
] as const

export type SyncDevice = z.infer<typeof syncDeviceSchema>
export type SyncStatus = z.infer<typeof syncStatusSchema>
export type SyncResult = z.infer<typeof syncResultSchema>
export type SyncEnableRequest = z.infer<typeof syncEnableRequestSchema>
export type SyncFullRequest = z.infer<typeof syncFullRequestSchema>
export type SyncDevicesRequest = z.infer<typeof syncDevicesRequestSchema>
export type SyncDevicesResponse = z.infer<typeof syncDevicesResponseSchema>
