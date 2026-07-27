export type SearchProjectResult = {
  id: string
  name: string
  topicCount: number
  sessionCount: number
}

export type SearchSpaceResult = {
  id: string
  name: string
  updatedAt?: string
}

export type SearchTopicResult = {
  id: string
  name: string
  projectId: string
  projectName: string
  sessionCount: number
}

export type SearchChatResult = {
  id: string
  name: string
  sessionKey?: string
  projectId?: string
  projectName?: string
  topicId?: string
  topicName?: string
}

export type SearchMessageResult = {
  id: string
  sessionKey: string
  messageId?: string
  role: string
  snippet: string
  chatId?: string
  chatName?: string
  projectId?: string
  projectName?: string
  topicId?: string
  topicName?: string
  createdAt?: string
}

export type GlobalSearchResponse = {
  spaces: SearchSpaceResult[]
  projects: SearchProjectResult[]
  topics: SearchTopicResult[]
  chats: SearchChatResult[]
  messages: SearchMessageResult[]
}

export type SessionRecord = {
  key: string
  label?: string | null
  hidden?: boolean
  updatedAt?: string
  projectId?: string
  topicId?: string
}

export type ProjectRecord = {
  id: string
  name: string
  archived: boolean
}

export type SpaceRecord = {
  id: string
  name: string
  archived: boolean
  updatedAt?: string
}

export type TopicRecord = {
  id: string
  name: string
  projectId: string
  archived: boolean
  updatedAt?: string
}

export type ChatRecord = {
  id: string
  name: string
  sessionKey?: string
  archived: boolean
  updatedAt?: string
}

export type SearchDatasets = {
  spaces: SpaceRecord[]
  projects: ProjectRecord[]
  topics: TopicRecord[]
  chats: ChatRecord[]
  sessions: SessionRecord[]
}
