import type { AgentNode } from "@/components/inspector/activity-types"

const root: AgentNode = { id: "root", label: "Main", status: "success", calls: [], children: [] }

export function useAgentActivity() {
  return {
    root,
    agents: [],
    calls: [],
    loading: false,
    error: null,
    refresh: () => undefined,
  }
}
