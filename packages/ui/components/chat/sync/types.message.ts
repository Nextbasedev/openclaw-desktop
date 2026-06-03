/**
 * Core message / run / tool types — mirrored from apps/middleware/src/features/chat
 * (repo.runs.ts, projection.ts, routes.serializeProjectedMessage).
 */

export type RunStatus =
  | "queued"
  | "thinking"
  | "streaming"
  | "tool_running"
  | "done"
  | "error"
  | "aborted";

export type RunOrIdle = RunStatus | "idle";

export type ToolPhase = "start" | "calling" | "update" | "result" | "error";
export type ToolStatus = "running" | "success" | "error";

/** Canonical semantic classifiers emitted by the middleware (payload.semanticType). */
export type ChatSemanticType =
  | "chat.user.created"
  | "chat.user.confirmed"
  | "chat.assistant.delta"
  | "chat.message.upsert"
  | "chat.assistant.final"
  | "chat.final"
  | "chat.reasoning.delta"
  | "chat.tool.started"
  | "chat.tool.update"
  | "chat.tool.result"
  | "chat.tool.error"
  | "chat.run.status"
  | "chat.run.streaming"
  | "chat.run.done"
  | "chat.run.error"
  | "chat.run.aborted"
  | "chat.status"
  | "chat.bootstrap"
  | "chat.history"
  | "session.upsert"
  // tolerate unknown future types without breaking the reducer
  | (string & {});

/** Loose OCPlatform message envelope as serialized by serializeProjectedMessage. */
export interface OCPlatformMessageData {
  role?: string;
  text?: string;
  content?: unknown;
  messageId?: string;
  createdAt?: string;
  isOptimistic?: boolean;
  __clientOptimistic?: boolean;
  model?: string;
  usage?: unknown;
  stopReason?: string;
  attachments?: unknown[];
  __openclaw?: {
    id?: string;
    seq?: number;
    gatewaySeq?: number | null;
    segmentId?: string | null;
    runId?: string | null;
    clientMessageId?: string | null;
    idempotencyKey?: string | null;
  };
  [key: string]: unknown;
}

/** projection.toolCallProjection output. */
export interface ToolCallProjection {
  toolCallId: string;
  id: string;
  sessionKey: string;
  runId: string | null;
  messageId: string | null;
  name: string;
  phase: ToolPhase;
  status: ToolStatus;
  argsMeta?: unknown;
  resultMeta?: unknown;
  awaitingResult?: boolean;
  resultSource?: string;
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
  updatedAtMs?: number;
}

/** projection.activeRunProjection output. */
export interface ActiveRunProjection {
  runId: string;
  gatewayRunId?: string | null;
  clientMessageId?: string | null;
  idempotencyKey?: string | null;
  status: RunStatus;
  statusLabel?: string | null;
  startedAtMs?: number | null;
  updatedAtMs?: number | null;
}
