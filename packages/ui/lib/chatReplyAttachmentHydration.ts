import type { ChatMessage, ReplyTo } from "@/components/ChatView/types"

function replyAttachmentMatchesMessageAttachment(
  replyAttachment: NonNullable<ReplyTo["attachments"]>[number],
  messageAttachment: NonNullable<ChatMessage["attachments"]>[number],
) {
  const sameName = replyAttachment.name === messageAttachment.name
  const sameMime = !replyAttachment.mimeType || !messageAttachment.mimeType || replyAttachment.mimeType === messageAttachment.mimeType
  const sameSize = typeof replyAttachment.size !== "number" || typeof messageAttachment.size !== "number" || replyAttachment.size === messageAttachment.size
  return sameName && sameMime && sameSize
}

function hasRenderableReplyAttachment(attachments: ReplyTo["attachments"] | undefined) {
  return Boolean(attachments?.some((attachment) => attachment.content || attachment.url))
}

export function hydrateReplyAttachmentPreviews(messages: ChatMessage[]) {
  const messagesById = new Map(messages.map((message) => [message.messageId, message]))
  return messages.map((message) => {
    const replyTo = message.replyTo
    if (!replyTo) return message

    const referenced = messagesById.get(replyTo.messageId)
    const hydratedReplyAttachments = hasRenderableReplyAttachment(replyTo.attachments)
      ? replyTo.attachments
      : referenced?.attachments?.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          content: attachment.content,
          url: attachment.url,
          size: attachment.size,
        })) ?? replyTo.attachments

    const filteredMessageAttachments = hydratedReplyAttachments?.length && message.attachments?.length
      ? message.attachments.filter((attachment) =>
          !hydratedReplyAttachments.some((replyAttachment) =>
            replyAttachmentMatchesMessageAttachment(replyAttachment, attachment)
          )
        )
      : message.attachments

    if (hydratedReplyAttachments === replyTo.attachments && filteredMessageAttachments === message.attachments) return message
    return {
      ...message,
      attachments: filteredMessageAttachments,
      replyTo: {
        ...replyTo,
        attachments: hydratedReplyAttachments,
      },
    }
  })
}
