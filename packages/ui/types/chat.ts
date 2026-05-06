export type Chat = {
  id: string
  name: string
  sessionKey?: string
  spaceId?: string
  agentId: string
  archived: boolean
  pinned: boolean
  lastActiveAt?: string
  createdAt: string
  updatedAt: string
  pendingFork?: boolean
}

export type ActiveChat = {
  id: string
  name: string
  sessionKey?: string
  cronJobId?: string
  cronRunId?: string
}
