import { z } from "zod"
import {
  defineEndpoint,
  nonEmptyStringSchema,
  profileIdSchema,
  projectIdSchema,
  sessionVisibilitySchema,
  topicIdSchema,
  uiModeSchema,
} from "./common"

export const settingsPreferencesSchema = z.object({
  showExistingSessions: z.boolean().default(false),
  sessionVisibility: sessionVisibilitySchema.default("jarvis-only"),
  uiMode: uiModeSchema.default("simple"),
  defaultProfileId: profileIdSchema.optional(),
  lastProjectId: projectIdSchema.optional(),
  lastTopicId: topicIdSchema.optional(),
})

export const configValueSchema = z.object({
  raw: z.string(),
  baseHash: z.string().optional(),
})

export const settingsConfigRequestSchema = z.object({}).strict()
export const settingsConfigResponseSchema = z.object({ config: configValueSchema })

export const settingsSchemaRequestSchema = z.object({}).strict()
export const settingsSchemaResponseSchema = z.object({ schema: z.record(z.string(), z.unknown()) })

export const settingsPreferencesRequestSchema = z.object({}).strict()
export const settingsPreferencesResponseSchema = z.object({ preferences: settingsPreferencesSchema })

export const updatePreferencesRequestSchema = settingsPreferencesSchema.partial()
export const updatePreferencesResponseSchema = z.object({ preferences: settingsPreferencesSchema })

export const settingsPatchRequestSchema = z.object({ raw: z.string(), baseHash: z.string().optional() })
export const settingsPatchResponseSchema = z.object({ ok: z.literal(true), changedPaths: z.array(nonEmptyStringSchema) })

export const settingsApplyRequestSchema = z.object({ restart: z.boolean().optional() })
export const settingsApplyResponseSchema = z.object({ ok: z.literal(true), restartRequired: z.boolean() })

export const settingsEndpoints = [
  defineEndpoint({ operationId: "settings.config", method: "GET", path: "/api/settings/config", request: settingsConfigRequestSchema, response: settingsConfigResponseSchema }),
  defineEndpoint({ operationId: "settings.schema", method: "GET", path: "/api/settings/schema", request: settingsSchemaRequestSchema, response: settingsSchemaResponseSchema }),
  defineEndpoint({ operationId: "settings.preferences.get", method: "GET", path: "/api/settings/preferences", request: settingsPreferencesRequestSchema, response: settingsPreferencesResponseSchema }),
  defineEndpoint({ operationId: "settings.preferences.update", method: "POST", path: "/api/settings/preferences", request: updatePreferencesRequestSchema, response: updatePreferencesResponseSchema }),
  defineEndpoint({ operationId: "settings.patch", method: "POST", path: "/api/settings/patch", request: settingsPatchRequestSchema, response: settingsPatchResponseSchema }),
  defineEndpoint({ operationId: "settings.apply", method: "POST", path: "/api/settings/apply", request: settingsApplyRequestSchema, response: settingsApplyResponseSchema }),
] as const

export type SettingsPreferences = z.infer<typeof settingsPreferencesSchema>

export type ConfigValue = z.infer<typeof configValueSchema>
export type SettingsConfigRequest = z.infer<typeof settingsConfigRequestSchema>
export type SettingsConfigResponse = z.infer<typeof settingsConfigResponseSchema>
export type SettingsSchemaRequest = z.infer<typeof settingsSchemaRequestSchema>
export type SettingsSchemaResponse = z.infer<typeof settingsSchemaResponseSchema>
export type SettingsPreferencesRequest = z.infer<typeof settingsPreferencesRequestSchema>
export type SettingsPreferencesResponse = z.infer<typeof settingsPreferencesResponseSchema>
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>
export type UpdatePreferencesResponse = z.infer<typeof updatePreferencesResponseSchema>
export type SettingsPatchRequest = z.infer<typeof settingsPatchRequestSchema>
export type SettingsPatchResponse = z.infer<typeof settingsPatchResponseSchema>
export type SettingsApplyRequest = z.infer<typeof settingsApplyRequestSchema>
export type SettingsApplyResponse = z.infer<typeof settingsApplyResponseSchema>
