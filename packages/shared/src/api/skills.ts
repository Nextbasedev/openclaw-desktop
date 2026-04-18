import { z } from "zod"
import { defineEndpoint, nonEmptyStringSchema, optionalTextSchema } from "./common"

export const skillSourceSchema = z.enum(["clawhub", "local", "github"])
export const skillInstallSourceSchema = z.enum(["clawhub", "github", "local"])
export const skillInstallScopeSchema = z.enum(["user", "workspace"])
export const skillInstallStatusSchema = z.enum(["installed", "updated", "already-installed"])

export const discoveredSkillSchema = z.object({
  id: nonEmptyStringSchema,
  slug: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  summary: optionalTextSchema.nullable(),
  description: optionalTextSchema.nullable(),
  source: skillSourceSchema,
  version: optionalTextSchema.nullable(),
  installed: z.boolean().default(false),
  installSource: skillInstallSourceSchema,
  repoUrl: optionalTextSchema.nullable(),
  homepageUrl: optionalTextSchema.nullable(),
  localPath: optionalTextSchema.nullable(),
  tags: z.array(nonEmptyStringSchema).default([]),
})

export const skillDiscoverRequestSchema = z.object({
  query: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).optional(),
  includeLocal: z.boolean().optional(),
  includeClawHub: z.boolean().optional(),
  includeGithubProbe: z.boolean().optional(),
})

export const skillDiscoverResponseSchema = z.object({
  query: z.string(),
  results: z.array(discoveredSkillSchema),
  warnings: z.array(z.string()),
  sources: z.array(skillSourceSchema),
})

export const skillInstallRequestSchema = z.object({
  source: skillInstallSourceSchema,
  slug: z.string().trim().optional(),
  version: z.string().trim().optional(),
  repoUrl: z.string().trim().optional(),
  ref: z.string().trim().optional(),
  localPath: z.string().trim().optional(),
  scope: skillInstallScopeSchema.optional(),
  force: z.boolean().optional(),
})

export const skillInstallResponseSchema = z.object({
  status: skillInstallStatusSchema,
  skill: discoveredSkillSchema,
  location: z.object({
    scope: skillInstallScopeSchema,
    root: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
  }),
  actions: z.array(nonEmptyStringSchema),
  warnings: z.array(z.string()),
})

export const skillEndpoints = [
  defineEndpoint({ operationId: "skills.discover", method: "GET", path: "/api/skills/discover", request: skillDiscoverRequestSchema, response: skillDiscoverResponseSchema }),
  defineEndpoint({ operationId: "skills.install", method: "POST", path: "/api/skills/install", request: skillInstallRequestSchema, response: skillInstallResponseSchema }),
] as const

export type SkillSource = z.infer<typeof skillSourceSchema>
export type SkillInstallSource = z.infer<typeof skillInstallSourceSchema>
export type SkillInstallScope = z.infer<typeof skillInstallScopeSchema>
export type SkillInstallStatus = z.infer<typeof skillInstallStatusSchema>
export type DiscoveredSkill = z.infer<typeof discoveredSkillSchema>
export type SkillDiscoverRequest = z.infer<typeof skillDiscoverRequestSchema>
export type SkillDiscoverResponse = z.infer<typeof skillDiscoverResponseSchema>
export type SkillInstallRequest = z.infer<typeof skillInstallRequestSchema>
export type SkillInstallResponse = z.infer<typeof skillInstallResponseSchema>
