import { textFromMessage } from "./message-normalizer.js";
import type { OpenClawMessage } from "./types.js";

export type ChatMessageSemanticType = "chat.user.confirmed" | "chat.assistant.final" | "chat.message.upsert";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toolCallBlocks(content: unknown) {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => {
    if (!isObject(block)) return false;
    return block.type === "toolCall" || block.type === "tool_use" || block.type === "tool_call" || block.type === "toolUse";
  });
}

export function messageHasToolCall(message: OpenClawMessage | Record<string, unknown> | null | undefined) {
  return Boolean(message && toolCallBlocks(message.content).length > 0);
}

export function messageHasVisibleText(message: OpenClawMessage | Record<string, unknown> | null | undefined) {
  return Boolean(message && textFromMessage(message as OpenClawMessage).trim().length > 0);
}

export function classifyChatMessageSemanticType(role: string | null | undefined, message: OpenClawMessage | Record<string, unknown>): ChatMessageSemanticType {
  if (role === "user") return "chat.user.confirmed";
  if (role !== "assistant") return "chat.message.upsert";

  // A tool-call assistant turn is not a final answer. Gateway uses assistant
  // messages for both "call this tool" and "final answer"; Desktop needs the
  // semantic distinction for Activity/timeline ordering.
  if (messageHasToolCall(message)) return "chat.message.upsert";

  return messageHasVisibleText(message) ? "chat.assistant.final" : "chat.message.upsert";
}

export function normalizePatchSemanticType(semanticType: string, payload?: Record<string, unknown>) {
  const message = payload?.message;
  if (semanticType === "chat.assistant.final" && isObject(message) && classifyChatMessageSemanticType("assistant", message) !== "chat.assistant.final") {
    return "chat.message.upsert";
  }
  return semanticType;
}
