"use client"

import * as React from "react"
import {
  CHAT_ATTACHMENT_LIMITS,
  releaseAttachmentPreview,
  toChatComposerAttachment,
  totalAttachmentBytes,
  type ChatComposerAttachment,
} from "@/lib/chatAttachments"

type Props = {
  disabled?: boolean
  onFilesProcessed?: () => void
}

export function useChatComposerAttachments({
  disabled,
  onFilesProcessed,
}: Props) {
  const [attachments, setAttachments] = React.useState<
    ChatComposerAttachment[]
  >([])
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  )
  const [isPreparingAttachments, setIsPreparingAttachments] =
    React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const attachmentsRef = React.useRef<ChatComposerAttachment[]>([])

  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        releaseAttachmentPreview(attachment)
      }
    }
  }, [])

  const clearAttachments = React.useCallback(() => {
    setAttachments((prev) => {
      for (const attachment of prev) {
        releaseAttachmentPreview(attachment)
      }
      return []
    })
  }, [])

  const removeAttachment = React.useCallback((attachmentId: string) => {
    setAttachmentError(null)
    setAttachments((prev) => {
      const attachment = prev.find((item) => item.id === attachmentId)
      if (attachment) {
        releaseAttachmentPreview(attachment)
      }
      return prev.filter((item) => item.id !== attachmentId)
    })
  }, [])

  const handleUploadClick = React.useCallback(() => {
    if (disabled || isPreparingAttachments) return
    fileInputRef.current?.click()
  }, [disabled, isPreparingAttachments])

  const processFiles = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      setAttachmentError(null)
      setIsPreparingAttachments(true)

      const existingAttachments = attachmentsRef.current
      const remainingSlots =
        CHAT_ATTACHMENT_LIMITS.maxCount - existingAttachments.length

      if (remainingSlots <= 0) {
        setAttachmentError(
          `You can attach up to ${CHAT_ATTACHMENT_LIMITS.maxCount} files per message.`,
        )
        setIsPreparingAttachments(false)
        return
      }

      const nextFiles = files.slice(0, remainingSlots)
      const errors: string[] = []
      const prepared: ChatComposerAttachment[] = []
      let totalBytes = totalAttachmentBytes(existingAttachments)

      if (files.length > remainingSlots) {
        errors.push(
          `Only ${remainingSlots} more file${remainingSlots === 1 ? "" : "s"} can be added.`,
        )
      }

      for (const file of nextFiles) {
        if (file.size > CHAT_ATTACHMENT_LIMITS.maxSingleBytes) {
          errors.push(`"${file.name}" exceeds the 50 MB limit.`)
          continue
        }

        if (totalBytes + file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
          errors.push("Total attachment size cannot exceed 100 MB.")
          continue
        }

        try {
          const attachment = await toChatComposerAttachment(file)
          prepared.push(attachment)
          totalBytes += file.size
        } catch {
          errors.push(`Failed to read "${file.name}".`)
        }
      }

      if (prepared.length > 0) {
        setAttachments((prev) => [...prev, ...prepared])
      }

      setAttachmentError(errors[0] ?? null)
      setIsPreparingAttachments(false)
      onFilesProcessed?.()
    },
    [onFilesProcessed],
  )

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ""
      await processFiles(files)
    },
    [processFiles],
  )

  return {
    attachments,
    attachmentError,
    isPreparingAttachments,
    fileInputRef,
    clearAttachments,
    removeAttachment,
    setAttachmentError,
    handleUploadClick,
    handleFileChange,
    processFiles,
  }
}
