/**
 * Stream + bootstrap snapshot types — mirrored from
 * apps/middleware/src/features/patches.ts (hello frame) and
 * projection.buildChatBootstrapSnapshot.
 */

import type { ActiveRunProjection, OCPlatformMessageData, RunOrIdle, ToolCallProjection } from "./types.message";
import type { ChatPatch } from "./types.patch";

/** WS hello frame from /api/stream/ws. */
export interface ChatStreamHello {
  type: "hello";
  clientId: string;
  afterCursor: number;
  replayCount: number;
  replayHasMore: boolean;
  replayWindowExceeded: boolean;
  recovery: "bootstrap" | null;
  droppedReplayCount: number;
}

export interface ChatStreamPatchFrame {
  type: "patch";
  patch: ChatPatch;
}

export type ChatStreamFrame = ChatStreamHello | ChatStreamPatchFrame;

/** buildChatBootstrapSnapshot output from GET /api/chat/bootstrap. */
export interface ChatBootstrapSnapshot {
  ok: boolean;
  source?: string;
  projectionVersion?: number;
  sessionKey: string;
  sessionId: string | null;
  runStatus: RunOrIdle;
  statusLabel: string | null;
  activeRun: ActiveRunProjection | null;
  historyCoverage?: "windowed" | "full";
  fullMessagesIncluded?: boolean;
  hasOlder: boolean;
  knownTotalMessages: number;
  oldestLoadedSeq: number | null;
  messages: OCPlatformMessageData[];
  messageCount: number;
  tools: ToolCallProjection[];
  toolCalls: ToolCallProjection[];
  cursor: number;
  sessionStatus?: string | null;
  thinkingLevel?: unknown;
  fastMode?: unknown;
  verboseLevel?: unknown;
}
