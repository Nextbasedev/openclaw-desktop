export type Space = {
  id: string
  name: string
  iconImage?: {
    name: string
    mimeType: string
    content: string
    encoding: "base64"
    size: number
  }
  repoRoot?: string
  projectId?: string
  sortOrder: number
  archived: boolean
  createdAt: string
  updatedAt: string
}
