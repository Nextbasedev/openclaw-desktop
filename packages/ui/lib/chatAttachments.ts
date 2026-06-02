export type ChatComposerAttachment = {
  name: string
  mimeType: string
  content?: string
  url?: string
  size?: number
}

export type ChatComposerSubmit = {
  text: string
  attachments?: ChatComposerAttachment[]
}
