import { invoke } from "@/lib/ipc"
import type { Chat } from "@/types/chat"

export type ChatListResponse = {
  chats: Chat[]
}

export async function fetchChats(
  archived = false,
): Promise<ChatListResponse> {
  return invoke<ChatListResponse>("middleware_chats_list", {
    input: { archived },
  })
}

export async function archiveChat(
  chatId: string,
  archived = true,
): Promise<{ ok: boolean; chatId: string; archived: boolean }> {
  return invoke("middleware_chats_archive", {
    input: { chatId, archived },
  })
}
