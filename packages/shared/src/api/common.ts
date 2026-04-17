import { z } from "zod"

export const httpMethodSchema = z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"])
export type HttpMethod = z.infer<typeof httpMethodSchema>

export const idSchema = z.string().min(1)
export const timestampSchema = z.string().datetime()
export const pathSchema = z.string().min(1)
export const nonEmptyStringSchema = z.string().min(1)
export const optionalTextSchema = z.string().trim().optional()

export const emptyRequestSchema = z.object({}).strict()

export const profileIdSchema = idSchema
export const projectIdSchema = idSchema
export const topicIdSchema = idSchema
export const sessionKeySchema = idSchema
export const terminalIdSchema = idSchema
export const inboxItemIdSchema = idSchema
export const approvalIdSchema = idSchema
export const bootstrapRunIdSchema = idSchema

export const createdUpdatedAtSchema = z.object({
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const profileRefSchema = z.object({
  id: profileIdSchema,
  name: nonEmptyStringSchema,
})

export const projectRefSchema = z.object({
  id: projectIdSchema,
  name: nonEmptyStringSchema,
})

export const topicRefSchema = z.object({
  id: topicIdSchema,
  name: nonEmptyStringSchema,
})

export const sessionRefSchema = z.object({
  key: sessionKeySchema,
  title: nonEmptyStringSchema,
})

export const connectionModeSchema = z.enum(["local", "remote"])
export const connectionStatusSchema = z.enum(["connected", "connecting", "disconnected", "error"])
export const topicArchiveStatusSchema = z.boolean()
export const sessionVisibilitySchema = z.enum(["jarvis-only", "all-visible"])
export const sessionStatusSchema = z.enum(["queued", "running", "idle", "completed", "error", "aborted"])
export const agentStatusSchema = z.enum(["online", "offline", "busy"])
export const fileNodeTypeSchema = z.enum(["file", "directory"])
export const gitFileStateSchema = z.enum(["modified", "added", "deleted", "renamed", "untracked"])
export const terminalStatusSchema = z.enum(["running", "closed"])
export const activityLevelSchema = z.enum(["info", "warning", "error"])
export const inboxStatusSchema = z.enum(["unread", "read", "archived"])
export const uiModeSchema = z.enum(["simple", "mission-control"])
export const approvalDecisionSchema = z.enum(["allow-once", "allow-always", "deny"])
export const bootstrapStatusSchema = z.enum(["planned", "running", "completed", "failed"])

export const environmentRefSchema = z.object({
  profileId: profileIdSchema,
  mode: connectionModeSchema,
})

export const apiSuccessSchema = z.object({
  ok: z.literal(true),
})

export const metadataSchema = z.record(z.string(), z.unknown())

export type EndpointContract<TRequest extends z.ZodTypeAny = z.ZodTypeAny, TResponse extends z.ZodTypeAny = z.ZodTypeAny> = {
  operationId: string
  method: HttpMethod
  path: string
  request: TRequest
  response: TResponse
}

export function defineEndpoint<TRequest extends z.ZodTypeAny, TResponse extends z.ZodTypeAny>(
  contract: EndpointContract<TRequest, TResponse>,
): EndpointContract<TRequest, TResponse> {
  return contract
}

export type Id = z.infer<typeof idSchema>
export type Timestamp = z.infer<typeof timestampSchema>
export type ApiPath = z.infer<typeof pathSchema>
export type ProfileId = z.infer<typeof profileIdSchema>
export type ProjectId = z.infer<typeof projectIdSchema>
export type TopicId = z.infer<typeof topicIdSchema>
export type SessionKey = z.infer<typeof sessionKeySchema>
export type TerminalId = z.infer<typeof terminalIdSchema>
export type InboxItemId = z.infer<typeof inboxItemIdSchema>
export type ApprovalId = z.infer<typeof approvalIdSchema>
export type BootstrapRunId = z.infer<typeof bootstrapRunIdSchema>
export type ConnectionMode = z.infer<typeof connectionModeSchema>
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>
export type SessionVisibility = z.infer<typeof sessionVisibilitySchema>
export type SessionStatus = z.infer<typeof sessionStatusSchema>
export type AgentStatus = z.infer<typeof agentStatusSchema>
export type GitFileState = z.infer<typeof gitFileStateSchema>
export type TerminalStatus = z.infer<typeof terminalStatusSchema>
export type ActivityLevel = z.infer<typeof activityLevelSchema>
export type InboxStatus = z.infer<typeof inboxStatusSchema>
export type UiMode = z.infer<typeof uiModeSchema>
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>
export type BootstrapStatus = z.infer<typeof bootstrapStatusSchema>
export type CreatedUpdatedAt = z.infer<typeof createdUpdatedAtSchema>
export type ProfileRef = z.infer<typeof profileRefSchema>
export type ProjectRef = z.infer<typeof projectRefSchema>
export type TopicRef = z.infer<typeof topicRefSchema>
export type SessionRef = z.infer<typeof sessionRefSchema>
export type EnvironmentRef = z.infer<typeof environmentRefSchema>
