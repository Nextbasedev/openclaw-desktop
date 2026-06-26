"use client"

import * as React from "react"
import {
  CHAT_ATTACHMENT_LIMITS,
  hydrateChatComposerAttachment,
  releaseAttachmentPreview,
  stripComposerAttachment,
  toChatComposerAttachment,
  totalAttachmentBytes,
  type ChatComposerAttachment,
  type ChatSendAttachment,
} from "@/lib/chatAttachments"

type Props = {
  disabled?: boolean
  onFilesProcessed?: () => void
  storageKey?: string | null
}

function loadPersistedAttachments(storageKey: string | null | undefined) {
  if (!storageKey || typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is ChatSendAttachment => {
        return Boolean(
          item &&
            typeof item.name === "string" &&
            typeof item.mimeType === "string" &&
            typeof item.content === "string" &&
            (item.encoding === "utf-8" || item.encoding === "base64") &&
            typeof item.size === "number"
        )
      })
      .slice(0, CHAT_ATTACHMENT_LIMITS.maxCount)
      .filter((item) => item.size <= CHAT_ATTACHMENT_LIMITS.maxSingleBytes)
      .reduce<ChatSendAttachment[]>((items, item) => {
        if (
          totalAttachmentBytes(items) + item.size >
          CHAT_ATTACHMENT_LIMITS.maxTotalBytes
        ) {
          return items
        }
        return [...items, item]
      }, [])
      .map(hydrateChatComposerAttachment)
  } catch {
    return []
  }
}

export function useChatComposerAttachments({
  disabled,
  onFilesProcessed,
  storageKey,
}: Props) {
  const [attachments, setAttachments] = React.useState<
    ChatComposerAttachment[]
  >(() => loadPersistedAttachments(storageKey))
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  )
  const [isPreparingAttachments, setIsPreparingAttachments] =
    React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const attachmentsRef = React.useRef<ChatComposerAttachment[]>([])
  const lastStorageKeyRef = React.useRef(storageKey ?? null)
  const skipNextPersistRef = React.useRef(false)

  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => {
    const nextStorageKey = storageKey ?? null
    if (lastStorageKeyRef.current === nextStorageKey) return

    for (const attachment of attachmentsRef.current) {
      releaseAttachmentPreview(attachment)
    }
    lastStorageKeyRef.current = nextStorageKey
    skipNextPersistRef.current = true
    setAttachments(loadPersistedAttachments(nextStorageKey))
    setAttachmentError(null)
  }, [storageKey])

  React.useEffect(() => {
    const activeStorageKey = lastStorageKeyRef.current
    if (
      !activeStorageKey ||
      activeStorageKey !== (storageKey ?? null) ||
      typeof localStorage === "undefined"
    ) {
      return
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false
      return
    }
    try {
      if (attachments.length > 0) {
        localStorage.setItem(
          activeStorageKey,
          JSON.stringify(attachments.map(stripComposerAttachment)),
        )
      } else {
        localStorage.removeItem(activeStorageKey)
      }
    } catch {}
  }, [attachments, storageKey])

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
          errors.push(`"${file.name}" exceeds the 10 MB limit.`)
          continue
        }

        if (totalBytes + file.size > CHAT_ATTACHMENT_LIMITS.maxTotalBytes) {
          errors.push("Total attachment size cannot exceed 10 MB.")
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
