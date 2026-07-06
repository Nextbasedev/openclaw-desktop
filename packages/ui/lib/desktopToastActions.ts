import { randomId } from "@/lib/id"
import { chatSendIdempotencyKey } from "@/lib/chat-engine-v2/idempotency"
import { sendChatV2, type SendChatV2Input } from "@/lib/chat-engine-v2/client"

export type ToastOpenPayload = {
  sessionKey: string
}

export type ToastReplyPayload = ToastOpenPayload & {
  text: string
}

type SendChat = (input: SendChatV2Input) => Promise<unknown>

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function parseToastOpenPayload(payload: unknown): ToastOpenPayload | null {
  const record = objectRecord(payload)
  if (!record) return null
  const sessionKey = stringField(record, "sessionKey")
  if (!sessionKey) return null
  return { sessionKey }
}

export function parseToastReplyPayload(payload: unknown): ToastReplyPayload | null {
  const openPayload = parseToastOpenPayload(payload)
  const record = objectRecord(payload)
  if (!openPayload || !record) return null
  const text = stringField(record, "text")
  if (!text) return null
  return { ...openPayload, text }
}

export async function sendToastReplyMessage(
  payload: unknown,
  deps: {
    sendChat?: SendChat
    createMessageId?: () => string
  } = {},
): Promise<ToastReplyPayload | null> {
  const reply = parseToastReplyPayload(payload)
  if (!reply) return null

  const clientMessageId = (deps.createMessageId ?? randomId)()
  const sendChat = deps.sendChat ?? sendChatV2
  await sendChat({
    sessionKey: reply.sessionKey,
    text: reply.text,
    idempotencyKey: chatSendIdempotencyKey(reply.sessionKey, clientMessageId),
    clientMessageId,
  })
  return reply
}
