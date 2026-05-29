export type SpaceIconImage = {
  name: string
  mimeType: string
  content: string
  encoding: "base64"
  size: number
}

export type SpaceIconEmoji = {
  emoji: string
  label?: string
  color?: string
}

export type Space = {
  id: string
  name: string
  iconEmoji?: SpaceIconEmoji
  iconImage?: SpaceIconImage
  repoRoot?: string
  projectId?: string
  sortOrder: number
  archived: boolean
  createdAt: string
  updatedAt: string
}
