import { z } from "zod"
import { defineEndpoint, nonEmptyStringSchema, projectIdSchema, sessionKeySchema, topicIdSchema } from "./common"

export const costUsageTotalsSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  totalCost: z.number(),
  inputCost: z.number(),
  outputCost: z.number(),
  cacheReadCost: z.number(),
  cacheWriteCost: z.number(),
})

export const messageCountsSchema = z.object({
  total: z.number(),
  user: z.number(),
  assistant: z.number(),
  toolCalls: z.number(),
  toolResults: z.number(),
  errors: z.number(),
})

export const sessionUsageEntrySchema = z.object({
  key: sessionKeySchema,
  label: z.string().optional(),
  model: z.string().optional(),
  totals: costUsageTotalsSchema,
  messageCounts: messageCountsSchema.optional(),
  firstActivity: z.number().optional(),
  lastActivity: z.number().optional(),
})

export const projectUsageSchema = z.object({
  projectId: projectIdSchema,
  projectName: nonEmptyStringSchema,
  totals: costUsageTotalsSchema,
  sessionCount: z.number().int().nonnegative(),
  sessions: z.array(sessionUsageEntrySchema),
})

export const topicUsageSchema = z.object({
  topicId: topicIdSchema.nullable(),
  topicName: z.string().nullable(),
  totals: costUsageTotalsSchema,
  sessionCount: z.number().int().nonnegative(),
  sessions: z.array(sessionUsageEntrySchema),
})

export const dailyUsageEntrySchema = z.object({
  date: z.string(),
  totalTokens: z.number(),
  totalCost: z.number(),
})

const dateFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

export const usageByProjectRequestSchema = dateFilterSchema.extend({
  profileId: nonEmptyStringSchema,
  projectId: projectIdSchema.optional(),
})
export const usageByProjectResponseSchema = z.object({
  projects: z.array(projectUsageSchema),
  truncated: z.boolean(),
})

export const usageByTopicRequestSchema = dateFilterSchema.extend({
  profileId: nonEmptyStringSchema,
  projectId: projectIdSchema,
  topicId: topicIdSchema.optional(),
})
export const usageByTopicResponseSchema = z.object({
  topics: z.array(topicUsageSchema),
  unassigned: topicUsageSchema,
  truncated: z.boolean(),
})

export const usageSummaryRequestSchema = dateFilterSchema.default({})
export const usageSummaryResponseSchema = z.object({
  totals: costUsageTotalsSchema,
  daily: z.array(dailyUsageEntrySchema),
  days: z.number().int().nonnegative(),
})

export const usageSessionRequestSchema = z.object({
  sessionKey: sessionKeySchema,
})
export const usageSessionResponseSchema = z.object({
  session: sessionUsageEntrySchema,
})

export const usageEndpoints = [
  defineEndpoint({ operationId: "usage.byProject", method: "POST", path: "/api/usage/by-project", request: usageByProjectRequestSchema, response: usageByProjectResponseSchema }),
  defineEndpoint({ operationId: "usage.byTopic", method: "POST", path: "/api/usage/by-topic", request: usageByTopicRequestSchema, response: usageByTopicResponseSchema }),
  defineEndpoint({ operationId: "usage.summary", method: "GET", path: "/api/usage/summary", request: usageSummaryRequestSchema, response: usageSummaryResponseSchema }),
  defineEndpoint({ operationId: "usage.session", method: "GET", path: "/api/usage/session", request: usageSessionRequestSchema, response: usageSessionResponseSchema }),
] as const

export type CostUsageTotals = z.infer<typeof costUsageTotalsSchema>
export type MessageCounts = z.infer<typeof messageCountsSchema>
export type SessionUsageEntry = z.infer<typeof sessionUsageEntrySchema>
export type ProjectUsage = z.infer<typeof projectUsageSchema>
export type TopicUsage = z.infer<typeof topicUsageSchema>
export type DailyUsageEntry = z.infer<typeof dailyUsageEntrySchema>
export type UsageByProjectRequest = z.infer<typeof usageByProjectRequestSchema>
export type UsageByProjectResponse = z.infer<typeof usageByProjectResponseSchema>
export type UsageByTopicRequest = z.infer<typeof usageByTopicRequestSchema>
export type UsageByTopicResponse = z.infer<typeof usageByTopicResponseSchema>
export type UsageSummaryResponse = z.infer<typeof usageSummaryResponseSchema>
export type UsageSessionRequest = z.infer<typeof usageSessionRequestSchema>
export type UsageSessionResponse = z.infer<typeof usageSessionResponseSchema>
