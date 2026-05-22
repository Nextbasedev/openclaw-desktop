import {
  classifyGatewayMessageSemanticType,
  messageHasToolCall,
  messageHasVisibleText,
  normalizePatchSemanticType,
  toolCallBlocks,
} from "./gateway-event-projector.js";

export type ChatMessageSemanticType = "chat.user.confirmed" | "chat.assistant.final" | "chat.message.upsert" | "chat.tool.result";

export {
  classifyGatewayMessageSemanticType as classifyChatMessageSemanticType,
  messageHasToolCall,
  messageHasVisibleText,
  normalizePatchSemanticType,
  toolCallBlocks,
};
