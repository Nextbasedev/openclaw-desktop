import { invoke } from "@/lib/ipc"
import { middlewareFetch } from "@/lib/middleware-client"
import type { Space } from "@/types/space"

export type SpaceListResponse = {
  spaces: Space[]
  activeSpaceId?: string | null
}

export async function fetchSpaces(
  archived = false,
): Promise<SpaceListResponse> {
  return invoke<SpaceListResponse>("middleware_spaces_list", {
    input: { archived },
  })
}

export async function archiveSpace(
  spaceId: string,
  archived = true,
): Promise<{ ok: boolean; activeSpaceId?: string | null; space?: Space }> {
  return invoke("middleware_spaces_archive", {
    input: { spaceId, archived },
  })
}

export async function renameSpace(
  spaceId: string,
  name: string,
): Promise<{ space: Space; activeSpaceId?: string | null }> {
  try {
    return await middlewareFetch(`/api/spaces/${spaceId}/rename`, {
      method: "POST",
      body: JSON.stringify({ spaceId, name }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.toLowerCase().includes("route not found") && !message.includes("404")) {
      throw error
    }
    try {
      return await invoke("middleware_spaces_rename", {
        input: { spaceId, name },
      })
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      if (
        !fallbackMessage.toLowerCase().includes("route not found") &&
        !fallbackMessage.includes("404")
      ) {
        throw fallbackError
      }
      return invoke("middleware_spaces_update", {
        input: { spaceId, name },
      })
    }
  }
}
