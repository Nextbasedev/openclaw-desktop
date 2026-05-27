export type SpaceIconImage = {
  name: string
  mimeType: string
  content: string
  encoding: "base64"
  size: number
}

export type Space = {
  id: string
  name: string
  iconImage?: SpaceIconImage
  ImageIcon?: SpaceIconImage
  imageIcon?: SpaceIconImage
  icon_image?: SpaceIconImage
  repoRoot?: string
  projectId?: string
  sortOrder: number
  archived: boolean
  createdAt: string
  updatedAt: string
}
