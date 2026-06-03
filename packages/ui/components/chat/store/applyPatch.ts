import type { ChatPatch, ChatPatchPayload } from "../sync/types.contract";
import { cloneState, reorder, type ChatSessionState } from "./state";
import { handleAssistantDelta, handleCanonicalMessage, handleReasoningDelta } from "./handlers/assistantHandlers";
import { handleRunStatus } from "./handlers/runHandlers";
import { handleTool } from "./handlers/toolHandlers";
import { handleUserConfirmed, handleUserCreated } from "./handlers/userHandlers";

export interface ApplyResult {
  state: ChatSessionState;
  /** true when the reducer detected a gap requiring re-bootstrap. */
  needsBootstrap: boolean;
  /** true when the patch was a no-op (duplicate / out-of-order). */
  ignored: boolean;
}

type Handler = (state: ChatSessionState, payload: ChatPatchPayload, now: number) => boolean;

const HANDLERS: Record<string, Handler> = {
  "chat.user.created": handleUserCreated,
  "chat.user.confirmed": handleUserConfirmed,
  "chat.assistant.delta": handleAssistantDelta,
  "chat.reasoning.delta": handleReasoningDelta,
  "chat.message.upsert": handleCanonicalMessage,
  "chat.assistant.final": handleCanonicalMessage,
  "chat.final": handleCanonicalMessage,
  "chat.tool.started": handleTool,
  "chat.tool.update": handleTool,
  "chat.tool.result": handleTool,
  "chat.tool.error": handleTool,
  "chat.run.status": handleRunStatus,
  "chat.run.streaming": handleRunStatus,
  "chat.run.done": handleRunStatus,
  "chat.run.error": handleRunStatus,
  "chat.run.aborted": handleRunStatus,
  "chat.status": handleRunStatus,
};

/** Apply a single patch. Pure: returns a new state (clone-on-write). */
export function applyPatch(prevState: ChatSessionState, patch: ChatPatch): ApplyResult {
  // Cursor guard: drop duplicates / already-applied patches.
  if (patch.cursor <= prevState.cursor) {
    return { state: prevState, needsBootstrap: false, ignored: true };
  }
  // Gap guard: a hole means missed patches; partial apply is worse than none.
  if (prevState.cursor > 0 && patch.cursor > prevState.cursor + 1) {
    return { state: prevState, needsBootstrap: true, ignored: false };
  }

  const payload = patch.payload ?? ({} as ChatPatchPayload);
  const handler = HANDLERS[payload.semanticType];
  const state = cloneState(prevState);

  // Unknown / structural-only types (chat.bootstrap, chat.history, session.upsert)
  // are no-ops here; canonical data arrives via subsequent message.upsert patches.
  const membershipChanged = handler ? handler(state, payload, Date.now()) : false;

  if (membershipChanged) reorder(state);
  state.cursor = patch.cursor;
  return { state, needsBootstrap: false, ignored: false };
}

/** Apply a batch of patches in cursor order. Stops and flags re-bootstrap on a gap. */
export function applyPatches(state: ChatSessionState, patches: ChatPatch[]): ApplyResult {
  let current = state;
  for (const patch of [...patches].sort((a, b) => a.cursor - b.cursor)) {
    const result = applyPatch(current, patch);
    if (result.needsBootstrap) return { state: current, needsBootstrap: true, ignored: false };
    current = result.state;
  }
  return { state: current, needsBootstrap: false, ignored: false };
}
