import { z } from "zod"
import {
  apiSuccessSchema,
  connectionModeSchema,
  connectionStatusSchema,
  defineEndpoint,
  emptyRequestSchema,
  metadataSchema,
  nonEmptyStringSchema,
  optionalTextSchema,
  pathSchema,
  profileIdSchema,
  timestampSchema,
} from "./common"

export const capabilitySnapshotSchema = z.object({
  openclaw: z.boolean(),
  files: z.boolean(),
  git: z.boolean(),
  terminal: z.boolean(),
  bootstrap: z.boolean(),
})

export const profileSchema = z.object({
  id: profileIdSchema,
  name: nonEmptyStringSchema,
  mode: connectionModeSchema,
  gatewayUrl: nonEmptyStringSchema,
  workspaceRoot: pathSchema,
  isDefault: z.boolean(),
  status: connectionStatusSchema,
  lastUsedAt: timestampSchema.optional(),
  lastError: optionalTextSchema,
  capabilities: capabilitySnapshotSchema.optional(),
  metadata: metadataSchema.optional(),
})

export const listProfilesRequestSchema = emptyRequestSchema
export const listProfilesResponseSchema = z.object({ profiles: z.array(profileSchema) })

export const createProfileRequestSchema = z.object({
  name: nonEmptyStringSchema,
  mode: connectionModeSchema,
  gatewayUrl: nonEmptyStringSchema,
  workspaceRoot: pathSchema,
  token: nonEmptyStringSchema.optional(),
  isDefault: z.boolean().optional(),
})
export const createProfileResponseSchema = z.object({ profile: profileSchema })

export const updateProfileRequestSchema = z.object({
  profileId: profileIdSchema,
  name: nonEmptyStringSchema.optional(),
  gatewayUrl: nonEmptyStringSchema.optional(),
  workspaceRoot: pathSchema.optional(),
  token: nonEmptyStringSchema.optional(),
  isDefault: z.boolean().optional(),
})
export const updateProfileResponseSchema = z.object({ profile: profileSchema })

export const deleteProfileRequestSchema = z.object({ profileId: profileIdSchema })
export const deleteProfileResponseSchema = apiSuccessSchema.extend({ deletedProfileId: profileIdSchema })

export const connectEnvironmentRequestSchema = z.object({ profileId: profileIdSchema })
export const connectEnvironmentResponseSchema = apiSuccessSchema.extend({
  profileId: profileIdSchema,
  status: connectionStatusSchema,
  capabilities: capabilitySnapshotSchema,
})

export const environmentStatusRequestSchema = z.object({ profileId: profileIdSchema })
export const environmentStatusResponseSchema = z.object({
  profileId: profileIdSchema,
  status: connectionStatusSchema,
  capabilities: capabilitySnapshotSchema.optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  serverUptimeSeconds: z.number().int().nonnegative().optional(),
})

export const detectEnvironmentRequestSchema = z.object({ profileId: profileIdSchema })
export const detectEnvironmentResponseSchema = z.object({ capabilities: capabilitySnapshotSchema })

export const profileEndpoints = [
  defineEndpoint({
    operationId: "profiles.list",
    method: "GET",
    path: "/api/profiles",
    request: listProfilesRequestSchema,
    response: listProfilesResponseSchema,
  }),
  defineEndpoint({
    operationId: "profiles.create",
    method: "POST",
    path: "/api/profiles",
    request: createProfileRequestSchema,
    response: createProfileResponseSchema,
  }),
  defineEndpoint({
    operationId: "profiles.update",
    method: "PATCH",
    path: "/api/profiles/:profileId",
    request: updateProfileRequestSchema,
    response: updateProfileResponseSchema,
  }),
  defineEndpoint({
    operationId: "profiles.delete",
    method: "DELETE",
    path: "/api/profiles/:profileId",
    request: deleteProfileRequestSchema,
    response: deleteProfileResponseSchema,
  }),
  defineEndpoint({
    operationId: "environment.connect",
    method: "POST",
    path: "/api/environment/connect",
    request: connectEnvironmentRequestSchema,
    response: connectEnvironmentResponseSchema,
  }),
  defineEndpoint({
    operationId: "environment.status",
    method: "GET",
    path: "/api/environment/status",
    request: environmentStatusRequestSchema,
    response: environmentStatusResponseSchema,
  }),
  defineEndpoint({
    operationId: "environment.detect",
    method: "POST",
    path: "/api/environment/detect",
    request: detectEnvironmentRequestSchema,
    response: detectEnvironmentResponseSchema,
  }),
] as const

export type Profile = z.infer<typeof profileSchema>
export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>

export type ListProfilesRequest = z.infer<typeof listProfilesRequestSchema>
export type ListProfilesResponse = z.infer<typeof listProfilesResponseSchema>
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>
export type CreateProfileResponse = z.infer<typeof createProfileResponseSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>
export type DeleteProfileRequest = z.infer<typeof deleteProfileRequestSchema>
export type DeleteProfileResponse = z.infer<typeof deleteProfileResponseSchema>
export type ConnectEnvironmentRequest = z.infer<typeof connectEnvironmentRequestSchema>
export type ConnectEnvironmentResponse = z.infer<typeof connectEnvironmentResponseSchema>
export type EnvironmentStatusRequest = z.infer<typeof environmentStatusRequestSchema>
export type EnvironmentStatusResponse = z.infer<typeof environmentStatusResponseSchema>
export type DetectEnvironmentRequest = z.infer<typeof detectEnvironmentRequestSchema>
export type DetectEnvironmentResponse = z.infer<typeof detectEnvironmentResponseSchema>
