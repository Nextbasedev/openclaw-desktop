export type Project = { id: string; name: string; archived: boolean }

export type FullTopic = {
  id: string
  name: string
  projectId: string
  archived: boolean
  unreadCount: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type ActiveTopic = {
  id: string
  name: string
  projectId: string
  projectName: string
}
