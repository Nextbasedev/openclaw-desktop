export type Chat = {
  id: string
  name: string
  title?: string
  archived?: boolean
  updatedAt?: string
  sessionKey?: string | null
  spaceId?: string | null
}

export type ChatListItem = Chat

export async function fetchChats(_archivedOrSpaceId?: boolean | string | null): Promise<{ chats: Chat[] }> {
  return { chats: [] }
}

export async function listChats(): Promise<ChatListItem[]> {
  return []
}

export async function archiveChat(_chatId: string, _archived?: boolean): Promise<void> {}
export async function unarchiveChat(_chatId: string): Promise<void> {}
