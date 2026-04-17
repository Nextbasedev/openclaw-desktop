import { z } from "zod"
import {
  apiSuccessSchema,
  defineEndpoint,
  inboxItemIdSchema,
  inboxStatusSchema,
  nonEmptyStringSchema,
  projectIdSchema,
  timestampSchema,
  topicIdSchema,
} from "./common"

export const inboxItemSchema = z.object({
  id: inboxItemIdSchema,
  sourceType: nonEmptyStringSchema,
  sourceId: z.string().min(1),
  projectId: projectIdSchema.optional(),
  topicId: topicIdSchema.optional(),
  title: nonEmptyStringSchema,
  body: z.string().optional(),
  status: inboxStatusSchema,
  createdAt: timestampSchema,
  readAt: timestampSchema.optional(),
})

export const unreadStateSchema = z.object({
  projectId: projectIdSchema.optional(),
  topicId: topicIdSchema.optional(),
  inboxUnreadCount: z.number().int().nonnegative(),
  topicUnreadCount: z.number().int().nonnegative(),
  projectUnreadCount: z.number().int().nonnegative(),
})

export const notificationRuleSchema = z.object({
  approvals: z.boolean(),
  failures: z.boolean(),
  desktopRemindersOnly: z.boolean(),
})

export const inboxListRequestSchema = z.object({ status: inboxStatusSchema.optional() }).default({})
export const inboxListResponseSchema = z.object({ items: z.array(inboxItemSchema) })

export const inboxMarkReadRequestSchema = z.object({ itemId: inboxItemIdSchema })
export const inboxMarkReadResponseSchema = apiSuccessSchema.extend({ itemId: inboxItemIdSchema })

export const inboxUnreadCountsRequestSchema = z.object({}).strict()
export const inboxUnreadCountsResponseSchema = z.object({ unread: unreadStateSchema })

export const notificationRulesRequestSchema = z.object({}).strict()
export const notificationRulesResponseSchema = z.object({ rules: notificationRuleSchema })

export const inboxEndpoints = [
  defineEndpoint({ operationId: "inbox.list", method: "GET", path: "/api/inbox", request: inboxListRequestSchema, response: inboxListResponseSchema }),
  defineEndpoint({ operationId: "inbox.markRead", method: "POST", path: "/api/inbox/:itemId/read", request: inboxMarkReadRequestSchema, response: inboxMarkReadResponseSchema }),
  defineEndpoint({ operationId: "inbox.unreadCounts", method: "GET", path: "/api/inbox/unread-counts", request: inboxUnreadCountsRequestSchema, response: inboxUnreadCountsResponseSchema }),
  defineEndpoint({ operationId: "notifications.rules", method: "GET", path: "/api/notifications/rules", request: notificationRulesRequestSchema, response: notificationRulesResponseSchema }),
] as const

export type InboxItem = z.infer<typeof inboxItemSchema>
export type UnreadState = z.infer<typeof unreadStateSchema>

export type NotificationRule = z.infer<typeof notificationRuleSchema>
export type InboxListRequest = z.infer<typeof inboxListRequestSchema>
export type InboxListResponse = z.infer<typeof inboxListResponseSchema>
export type InboxMarkReadRequest = z.infer<typeof inboxMarkReadRequestSchema>
export type InboxMarkReadResponse = z.infer<typeof inboxMarkReadResponseSchema>
export type InboxUnreadCountsRequest = z.infer<typeof inboxUnreadCountsRequestSchema>
export type InboxUnreadCountsResponse = z.infer<typeof inboxUnreadCountsResponseSchema>
export type NotificationRulesRequest = z.infer<typeof notificationRulesRequestSchema>
export type NotificationRulesResponse = z.infer<typeof notificationRulesResponseSchema>
