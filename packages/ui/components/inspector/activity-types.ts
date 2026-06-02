export type ToolCallStatus = "running" | "success" | "error"
export type AgentNode = {
  id: string
  label: string
  description?: string
  status: ToolCallStatus
  calls: Array<{ id: string; startedAt?: number; status: ToolCallStatus }>
  children?: AgentNode[]
}
