import type { ChatPatch, ChatPatchPayload, ChatSemanticType } from "../../sync/types.contract";

export const SESSION = "agent:main:test:session";
export const RUN = "run-1";
export const CLIENT_ID = "client:idem-1";
export const IDEMPOTENCY = "idem-1";
export const CANONICAL_USER_ID = "msg-user-canonical";
export const CANONICAL_ASSISTANT_ID = "msg-assistant-canonical";
export const TOOL_ID = "tool-call-1";

let cursorSeq = 0;
export function resetCursor() {
  cursorSeq = 0;
}

export function patch(semanticType: ChatSemanticType, payload: Partial<ChatPatchPayload>, eventType?: string): ChatPatch {
  cursorSeq += 1;
  return {
    cursor: cursorSeq,
    type: eventType ?? semanticType,
    sessionKey: SESSION,
    createdAtMs: 1_700_000_000_000 + cursorSeq,
    payload: {
      projectionVersion: 3,
      sessionKey: SESSION,
      semanticType,
      ...payload,
    },
  };
}

/** Optimistic user echo (POST /api/chat/send). */
export function userCreated(text: string): ChatPatch {
  return patch(
    "chat.user.created",
    {
      runId: RUN,
      clientMessageId: CLIENT_ID,
      idempotencyKey: IDEMPOTENCY,
      messageId: CLIENT_ID,
      optimistic: true,
      message: {
        role: "user",
        text,
        isOptimistic: true,
        __openclaw: { id: CLIENT_ID, clientMessageId: CLIENT_ID, idempotencyKey: IDEMPOTENCY, runId: RUN },
      },
    },
    "chat.message.upsert",
  );
}

/** Canonical user confirm (gateway echo). */
export function userConfirmed(text: string, seq: number): ChatPatch {
  return patch(
    "chat.user.confirmed",
    {
      runId: RUN,
      messageId: CANONICAL_USER_ID,
      optimisticId: CLIENT_ID,
      gatewayMessageId: CANONICAL_USER_ID,
      messageSeq: seq,
      message: {
        role: "user",
        text,
        __openclaw: { id: CANONICAL_USER_ID, seq, runId: RUN },
      },
    },
    "chat.message.confirmed",
  );
}

export function runStatus(status: string, label: string | null, semanticType: ChatSemanticType = "chat.run.status"): ChatPatch {
  const active = ["queued", "thinking", "streaming", "tool_running"].includes(status);
  return patch(
    semanticType,
    {
      runId: RUN,
      runStatus: status as never,
      status,
      statusLabel: label,
      activeRun: active
        ? { runId: RUN, status: status as never, statusLabel: label, startedAtMs: 1_700_000_000_000 }
        : null,
    },
    "chat.status",
  );
}

/** Assistant streaming chunk (cumulative full text). */
export function assistantDelta(fullText: string): ChatPatch {
  const messageId = `live:${RUN}:assistant`;
  return patch(
    "chat.assistant.delta",
    {
      runId: RUN,
      messageId,
      message: { id: messageId, role: "assistant", text: fullText, __openclaw: { id: messageId, runId: RUN } },
    },
    "chat.message.upsert",
  );
}

export function reasoningDelta(fullText: string): ChatPatch {
  return patch("chat.reasoning.delta", { runId: RUN, text: fullText, delta: fullText });
}

export function toolStarted(name: string): ChatPatch {
  return patch("chat.tool.started", {
    runId: RUN,
    toolCallId: TOOL_ID,
    phase: "start",
    toolCall: {
      toolCallId: TOOL_ID, id: TOOL_ID, sessionKey: SESSION, runId: RUN, messageId: null,
      name, phase: "start", status: "running", startedAtMs: 1_700_000_000_010, updatedAtMs: 1_700_000_000_010,
    },
  });
}

export function toolResult(name: string, output: string): ChatPatch {
  return patch("chat.tool.result", {
    runId: RUN,
    toolCallId: TOOL_ID,
    phase: "result",
    output,
    result: output,
    toolCall: {
      toolCallId: TOOL_ID, id: TOOL_ID, sessionKey: SESSION, runId: RUN, messageId: null,
      name, phase: "result", status: "success", startedAtMs: 1_700_000_000_010, finishedAtMs: 1_700_000_000_050, updatedAtMs: 1_700_000_000_050,
    },
  });
}

/**
 * Canonical assistant final body. Mirrors the REAL wire: the success terminal
 * (runStatus:done, activeRun:null) is embedded HERE — there is no separate
 * chat.run.done frame. (Verified against captured /api/patches golden streams.)
 */
export function assistantFinal(text: string, seq: number): ChatPatch {
  return patch(
    "chat.assistant.final",
    {
      runId: RUN,
      messageId: CANONICAL_ASSISTANT_ID,
      messageSeq: seq,
      runStatus: "done" as never,
      status: "done",
      activeRun: null,
      message: {
        role: "assistant", text, model: "test-model", stopReason: "stop",
        __openclaw: { id: CANONICAL_ASSISTANT_ID, seq, runId: RUN },
      },
    },
    "chat.message.upsert",
  );
}

export function runDone(): ChatPatch {
  return runStatus("done", null, "chat.run.done");
}
