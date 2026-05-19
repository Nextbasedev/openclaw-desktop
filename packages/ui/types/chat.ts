export type Chat = {
  id: string
  name: string
  sessionKey?: string
  spaceId?: string
  agentId: string
  archived: boolean
  archivedBySpace?: boolean
  pinned: boolean
  lastActiveAt?: string
  lastMessageAt?: string
  createdAt: string
  updatedAt: string
  pendingFork?: boolean
  parentSessionKey?: string | null
  isSubagent?: boolean
}

export type ActiveChat = {
  id: string
  name: string
  sessionKey?: string
  cronJobId?: string
  cronRunId?: string
}
