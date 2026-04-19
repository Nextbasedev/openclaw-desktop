import { ensureGatewayClient } from "../gateway/client.js"

function wrapGatewayError(error: unknown): never {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes("enoent") ||
      msg.includes("token is missing") ||
      msg.includes("websocket") ||
      msg.includes("timeout") ||
      msg.includes("connect")
    ) {
      throw new Error(
        "Gateway not connected. Start the OpenClaw Gateway first.",
      )
    }
  }
  throw error
}

export async function skillsInstalled(input?: {
  agentId?: string
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<Record<string, unknown>>(
      "skills.status",
      { agentId: input?.agentId },
    )
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "skills.status failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function skillsSearchHub(input?: {
  query?: string
  limit?: number
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      results: Array<Record<string, unknown>>
    }>("skills.search", {
      query: input?.query,
      limit: input?.limit,
    })
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "skills.search failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function commandsList(input?: {
  agentId?: string
  provider?: string
  scope?: "native" | "text" | "both"
  includeArgs?: boolean
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      commands: Array<{
        name: string
        nativeName?: string
        textAliases?: string[]
        description: string
        category?: string
        source: "native" | "skill" | "plugin"
        scope: "text" | "native" | "both"
        acceptsArgs: boolean
        args?: Array<{
          name: string
          description: string
          type: string
          required?: true
          choices?: Array<{ value: string; label: string }>
          dynamic?: true
        }>
      }>
    }>("commands.list", {
      agentId: input?.agentId,
      provider: input?.provider,
      scope: input?.scope,
      includeArgs: input?.includeArgs,
    })
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "commands.list failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function toolsCatalog(input?: {
  agentId?: string
  includePlugins?: boolean
}) {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      agentId: string
      profiles: Array<{ id: string; label: string }>
      groups: Array<{
        id: string
        label: string
        source: "core" | "plugin"
        pluginId?: string
        tools: Array<{
          id: string
          label: string
          description: string
          source: "core" | "plugin"
          pluginId?: string
          optional?: boolean
          defaultProfiles: string[]
        }>
      }>
    }>("tools.catalog", {
      agentId: input?.agentId,
      includePlugins: input?.includePlugins,
    })
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "tools.catalog failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}
