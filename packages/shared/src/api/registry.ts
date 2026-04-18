import { z } from "zod"
import type { EndpointContract } from "./common"
import { activityEndpoints } from "./activity"
import { adminAccessEndpoints } from "./admin-access"
import { approvalEndpoints } from "./approvals"
import { bootstrapEndpoints } from "./bootstrap"
import { chatEndpoints } from "./chat"
import { fileEndpoints } from "./files"
import { gitEndpoints } from "./git"
import { inboxEndpoints } from "./inbox"
import { memoryEndpoints } from "./memory"
import { navigationEndpoints } from "./navigation"
import { profileEndpoints } from "./profiles"
import { projectEndpoints } from "./projects"
import { sessionEndpoints } from "./sessions"
import { settingsEndpoints } from "./settings"
import { skillEndpoints } from "./skills"
import { terminalEndpoints } from "./terminal"
import { topicEndpoints } from "./topics"

export const middlewareContracts = [
  ...profileEndpoints,
  ...projectEndpoints,
  ...topicEndpoints,
  ...navigationEndpoints,
  ...sessionEndpoints,
  ...chatEndpoints,
  ...fileEndpoints,
  ...gitEndpoints,
  ...terminalEndpoints,
  ...activityEndpoints,
  ...adminAccessEndpoints,
  ...inboxEndpoints,
  ...memoryEndpoints,
  ...settingsEndpoints,
  ...skillEndpoints,
  ...approvalEndpoints,
  ...bootstrapEndpoints,
] as const satisfies readonly EndpointContract[]

type MiddlewareContractTuple = typeof middlewareContracts
export type MiddlewareContract = MiddlewareContractTuple[number]
export type MiddlewareOperationId = MiddlewareContract["operationId"]

export const middlewareContractRegistry = Object.fromEntries(
  middlewareContracts.map((contract) => [contract.operationId, contract]),
) as { [K in MiddlewareOperationId]: Extract<MiddlewareContract, { operationId: K }> }

export const middlewareOperationIds = middlewareContracts.map((contract) => contract.operationId) as MiddlewareOperationId[]

export type MiddlewareRequestOf<TOperationId extends MiddlewareOperationId> = z.infer<
  (typeof middlewareContractRegistry)[TOperationId]["request"]
>

export type MiddlewareResponseOf<TOperationId extends MiddlewareOperationId> = z.infer<
  (typeof middlewareContractRegistry)[TOperationId]["response"]
>

export function parseMiddlewareRequest<TOperationId extends MiddlewareOperationId>(
  operationId: TOperationId,
  input: unknown,
): MiddlewareRequestOf<TOperationId>
export function parseMiddlewareRequest<TRequest extends z.ZodTypeAny>(schema: TRequest, input: unknown): z.infer<TRequest>
export function parseMiddlewareRequest<TRequest extends z.ZodTypeAny>(
  operationIdOrSchema: MiddlewareOperationId | TRequest,
  input: unknown,
) {
  const schema = typeof operationIdOrSchema === "string" ? middlewareContractRegistry[operationIdOrSchema]!.request : operationIdOrSchema
  return schema.parse(input)
}

export function parseMiddlewareResponse<TOperationId extends MiddlewareOperationId>(
  operationId: TOperationId,
  input: unknown,
): MiddlewareResponseOf<TOperationId>
export function parseMiddlewareResponse<TResponse extends z.ZodTypeAny>(schema: TResponse, input: unknown): z.infer<TResponse>
export function parseMiddlewareResponse<TResponse extends z.ZodTypeAny>(
  operationIdOrSchema: MiddlewareOperationId | TResponse,
  input: unknown,
) {
  const schema = typeof operationIdOrSchema === "string" ? middlewareContractRegistry[operationIdOrSchema]!.response : operationIdOrSchema
  return schema.parse(input)
}
