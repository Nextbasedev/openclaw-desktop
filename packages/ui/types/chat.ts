export type Chat = {
  id: string
  name: string
  sessionKey?: string
  agentId: string
  archived: boolean
  pinned: boolean
  lastActiveAt?: string
  createdAt: string
  updatedAt: string
}

export type ActiveChat = {
  id: string
  name: string
  sessionKey?: string
  cronJobId?: string
}
