export type ActiveTopic = {
  id: string
  name: string
  projectId: string
  projectName: string
  sessionKey?: string | null
}

export type ActiveChat = {
  id: string
  name: string
  sessionKey?: string | null
  spaceId?: string | null
  projectId?: string | null
  topicId?: string | null
}
