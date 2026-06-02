export type Topic = {
  id: string
  name: string
  title?: string
  archived?: boolean
  updatedAt?: string
  projectId?: string | null
  projectName?: string | null
}

export type TopicListItem = Topic

export async function fetchTopics(_archivedOrProjectId?: boolean | string | null): Promise<{ topics: Topic[] }> {
  return { topics: [] }
}

export async function listTopics(): Promise<TopicListItem[]> {
  return []
}

export async function archiveTopic(_topicId: string, _archived?: boolean): Promise<void> {}
export async function unarchiveTopic(_topicId: string): Promise<void> {}
