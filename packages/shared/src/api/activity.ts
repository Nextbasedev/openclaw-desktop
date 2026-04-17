import { z } from "zod"
import {
  activityLevelSchema,
  defineEndpoint,
  nonEmptyStringSchema,
  projectIdSchema,
  sessionKeySchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const activityEventSchema = z.object({
  id: z.string().min(1),
  projectId: projectIdSchema,
  topicId: topicIdSchema.optional(),
  sessionKey: sessionKeySchema.optional(),
  kind: nonEmptyStringSchema,
  title: nonEmptyStringSchema,
  summary: z.string().optional(),
  level: activityLevelSchema,
  createdAt: timestampSchema,
})

export const agentTreeNodeSchema: z.ZodType<{
  id: string
  label: string
  status: "running" | "done" | "failed"
  children: Array<{ id: string; label: string; status: "running" | "done" | "failed"; children: unknown[] }>
}> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: nonEmptyStringSchema,
    status: z.enum(["running", "done", "failed"]),
    children: z.array(agentTreeNodeSchema),
  }),
)

export const processSummarySchema = z.object({
  id: z.string().min(1),
  label: nonEmptyStringSchema,
  status: z.enum(["running", "completed", "failed"]),
  projectId: projectIdSchema,
  sessionKey: sessionKeySchema.optional(),
})

export const activityFeedRequestSchema = z.object({ projectId: projectIdSchema })
export const activityFeedResponseSchema = z.object({ items: z.array(activityEventSchema) })

export const activitySubscribeRequestSchema = z.object({ projectId: projectIdSchema })
export const activitySubscribeResponseSchema = z.object({ stream: z.literal("activity.event") })

export const agentsTreeRequestSchema = z.object({ projectId: projectIdSchema })
export const agentsTreeResponseSchema = z.object({ roots: z.array(agentTreeNodeSchema) })

export const processesListRequestSchema = z.object({ projectId: projectIdSchema })
export const processesListResponseSchema = z.object({ processes: z.array(processSummarySchema) })

export const activityEndpoints = [
  defineEndpoint({ operationId: "activity.feed", method: "GET", path: "/api/activity/feed", request: activityFeedRequestSchema, response: activityFeedResponseSchema }),
  defineEndpoint({ operationId: "activity.subscribe", method: "GET", path: "/api/activity/subscribe", request: activitySubscribeRequestSchema, response: activitySubscribeResponseSchema }),
  defineEndpoint({ operationId: "agents.tree", method: "GET", path: "/api/agents/tree", request: agentsTreeRequestSchema, response: agentsTreeResponseSchema }),
  defineEndpoint({ operationId: "processes.list", method: "GET", path: "/api/processes", request: processesListRequestSchema, response: processesListResponseSchema }),
] as const

export type ActivityEvent = z.infer<typeof activityEventSchema>
export type AgentTreeNode = z.infer<typeof agentTreeNodeSchema>
export type ProcessSummary = z.infer<typeof processSummarySchema>
export type ActivityFeedRequest = z.infer<typeof activityFeedRequestSchema>
export type ActivityFeedResponse = z.infer<typeof activityFeedResponseSchema>
export type ActivitySubscribeRequest = z.infer<typeof activitySubscribeRequestSchema>
export type ActivitySubscribeResponse = z.infer<typeof activitySubscribeResponseSchema>
export type AgentsTreeRequest = z.infer<typeof agentsTreeRequestSchema>
export type AgentsTreeResponse = z.infer<typeof agentsTreeResponseSchema>
export type ProcessesListRequest = z.infer<typeof processesListRequestSchema>
export type ProcessesListResponse = z.infer<typeof processesListResponseSchema>
