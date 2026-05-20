import { textFromMessage } from "./message-normalizer.js";
import type { OpenClawMessage } from "./types.js";

export type GatewayMessageSemanticType = "chat.user.confirmed" | "chat.assistant.final" | "chat.message.upsert" | "chat.tool.result";
export type GatewayToolPhase = "start" | "calling" | "update" | "result" | "error";

export type GatewayProjectedToolEvent = {
  toolCallId: string;
  name: string | null;
  phase: GatewayToolPhase;
  args: unknown;
  result: unknown;
};

export type GatewayProjectedMessage = {
  role: string | null;
  semanticType: GatewayMessageSemanticType;
  emitMessagePatch: boolean;
  assistantHasToolCalls: boolean;
  assistantHasFinalText: boolean;
  isToolResultMessage: boolean;
  toolEvents: GatewayProjectedToolEvent[];
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toolCallBlocks(content: unknown) {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => {
    if (!isObject(block)) return false;
    return block.type === "toolCall" || block.type === "tool_use" || block.type === "tool_call" || block.type === "toolUse";
  });
}

export function toolResultBlocks(content: unknown) {
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => {
    if (!isObject(block)) return false;
    return block.type === "toolResult" || block.type === "tool_result" || block.type === "tool_result_block" || block.type === "toolResultBlock";
  });
}

export function readToolCallId(value: Record<string, unknown>) {
  const id = value.toolCallId ?? value.id ?? value.tool_call_id ?? value.toolUseId ?? value.tool_use_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function readToolName(value: Record<string, unknown>) {
  const name = value.name ?? value.toolName ?? value.tool_name ?? value.tool;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export function readToolArgs(value: Record<string, unknown>) {
  return value.arguments ?? value.input ?? value.args ?? value.argsMeta ?? null;
}

export function readToolResult(value: Record<string, unknown>) {
  return value.result ?? value.output ?? value.content ?? value.text ?? value.message ?? value.value ?? null;
}

export function isToolResultRole(role: unknown) {
  return role === "tool" || role === "toolResult" || role === "tool_result";
}

export function messageHasToolCall(message: OpenClawMessage | Record<string, unknown> | null | undefined) {
  return Boolean(message && toolCallBlocks(message.content).length > 0);
}

export function messageHasVisibleText(message: OpenClawMessage | Record<string, unknown> | null | undefined) {
  return Boolean(message && textFromMessage(message as OpenClawMessage).trim().length > 0);
}

export function projectGatewayMessage(message: OpenClawMessage | Record<string, unknown>): GatewayProjectedMessage {
  const role = typeof message.role === "string" ? message.role : null;
  const assistantHasToolCalls = role === "assistant" && messageHasToolCall(message);
  const assistantHasFinalText = role === "assistant" && messageHasVisibleText(message) && !assistantHasToolCalls;
  const isToolResultMessage = isToolResultRole(role) || toolResultBlocks(message.content).length > 0;
  const toolEvents = extractToolEventsFromMessage(message);

  if (isToolResultMessage) {
    return {
      role,
      semanticType: "chat.tool.result",
      emitMessagePatch: false,
      assistantHasToolCalls,
      assistantHasFinalText: false,
      isToolResultMessage,
      toolEvents,
    };
  }

  if (role === "user") {
    return {
      role,
      semanticType: "chat.user.confirmed",
      emitMessagePatch: true,
      assistantHasToolCalls,
      assistantHasFinalText,
      isToolResultMessage,
      toolEvents,
    };
  }

  if (role === "assistant") {
    return {
      role,
      semanticType: assistantHasFinalText ? "chat.assistant.final" : "chat.message.upsert",
      emitMessagePatch: true,
      assistantHasToolCalls,
      assistantHasFinalText,
      isToolResultMessage,
      toolEvents,
    };
  }

  return {
    role,
    semanticType: "chat.message.upsert",
    emitMessagePatch: true,
    assistantHasToolCalls,
    assistantHasFinalText,
    isToolResultMessage,
    toolEvents,
  };
}

export function classifyGatewayMessageSemanticType(role: string | null | undefined, message: OpenClawMessage | Record<string, unknown>): GatewayMessageSemanticType {
  return projectGatewayMessage({ ...message, role: role ?? message.role }).semanticType;
}

export function normalizePatchSemanticType(semanticType: string, payload?: Record<string, unknown>) {
  const message = payload?.message;
  if (semanticType === "chat.assistant.final" && isObject(message) && projectGatewayMessage({ ...message, role: "assistant" }).semanticType !== "chat.assistant.final") {
    return "chat.message.upsert";
  }
  return semanticType;
}

export function extractToolEventsFromMessage(message: OpenClawMessage | Record<string, unknown>): GatewayProjectedToolEvent[] {
  const events: GatewayProjectedToolEvent[] = [];
  for (const block of toolCallBlocks(message.content)) {
    const toolCallId = readToolCallId(block);
    if (!toolCallId) continue;
    events.push({
      toolCallId,
      name: readToolName(block),
      phase: "calling",
      args: readToolArgs(block),
      result: null,
    });
  }

  for (const block of toolResultBlocks(message.content)) {
    const toolCallId = readToolCallId(block);
    if (!toolCallId) continue;
    events.push({
      toolCallId,
      name: readToolName(block) ?? readToolName(message as Record<string, unknown>),
      phase: block.is_error === true || block.isError === true ? "error" : "result",
      args: null,
      result: readToolResult(block),
    });
  }

  if (isToolResultRole(message.role)) {
    const topLevelToolCallId = readToolCallId(message as Record<string, unknown>);
    if (topLevelToolCallId) {
      events.push({
        toolCallId: topLevelToolCallId,
        name: readToolName(message as Record<string, unknown>),
        phase: "result",
        args: null,
        result: message.content ?? message.text ?? null,
      });
    }
  }

  return events;
}
