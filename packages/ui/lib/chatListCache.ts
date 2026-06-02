export function invalidateChatListCache() {}
export async function fetchChatsForSpace(_spaceId?: string | null) { return { chats: [] } }
export async function loadCachedChatsForSpace(_spaceId?: string | null) { return null }
