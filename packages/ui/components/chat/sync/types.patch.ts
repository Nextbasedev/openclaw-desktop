/**
 * Patch envelope types — mirrored from apps/middleware/src/features/patches.ts
 * (PatchPayload) and projection.canonicalPatchPayload.
 *
 * IMPORTANT: classify patches by `payload.semanticType`, NOT the top-level `type`
 * (eventType). e.g. an assistant streaming chunk arrives as
 *   { type: "chat.message.upsert", payload: { semanticType: "chat.assistant.delta" } }
 */

import type {
  ActiveRunProjection,
  ChatSemanticType,
  OCPlatformMessageData,
  RunOrIdle,
  ToolCallProjection,
  ToolPhase,
} from "./types.message";

/** The `payload` carried inside every patch (canonicalPatchPayload + custom merge). */
export interface ChatPatchPayload {
  projectionVersion?: number;
  semanticType: ChatSemanticType;
  sessionKey: string;

  // run identity block (present when a run is associated)
  runId?: string;
  gatewayRunId?: string | null;
  clientMessageId?: string | null;
  idempotencyKey?: string | null;
  runStatus?: RunOrIdle;
  status?: string | null;
  statusLabel?: string | null;
  activeRun?: ActiveRunProjection | null;

  // message identity
  messageId?: string | null;

  // tool block
  toolCallId?: string;
  toolCall?: ToolCallProjection;
  phase?: ToolPhase;
  output?: unknown;
  result?: unknown;

  // message body / streaming
  message?: OCPlatformMessageData;
  text?: string;
  delta?: string;

  // user optimistic reconciliation
  optimistic?: boolean;
  optimisticId?: string;
  gatewayMessageId?: string | null;

  // sequencing
  messageSeq?: number;
  lastSeq?: number;

  [key: string]: unknown;
}

/** Patch envelope. WS frame is { type: "patch", patch }. */
export interface ChatPatch {
  cursor: number;
  type: string; // eventType (NOT the classifier — use payload.semanticType)
  sessionKey: string | null;
  payload: ChatPatchPayload;
  createdAtMs: number;
}
