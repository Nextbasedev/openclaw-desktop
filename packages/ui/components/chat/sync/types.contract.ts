/**
 * Chat middleware contract (v5) — barrel.
 *
 * The middleware (apps/middleware/src/features/chat) is the single source of truth;
 * the desktop chat frontend is a cursor-ordered projection of it. Types are split
 * by concern (message / patch / stream) and re-exported here for ergonomic imports.
 */

export type {
  RunStatus,
  RunOrIdle,
  ToolPhase,
  ToolStatus,
  ChatSemanticType,
  OCPlatformMessageData,
  ToolCallProjection,
  ActiveRunProjection,
} from "./types.message";

export type { ChatPatch, ChatPatchPayload } from "./types.patch";

export type {
  ChatStreamHello,
  ChatStreamPatchFrame,
  ChatStreamFrame,
  ChatBootstrapSnapshot,
} from "./types.stream";
