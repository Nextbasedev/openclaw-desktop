import { describe, expect, it } from "vitest"
import type { EndpointContract } from "./common"
import {
  activityEndpoints,
  adminAccessEndpoints,
  approvalEndpoints,
  bootstrapEndpoints,
  chatEndpoints,
  fileEndpoints,
  gitEndpoints,
  inboxEndpoints,
  memoryEndpoints,
  middlewareContractRegistry,
  middlewareContracts,
  middlewareOperationIds,
  navigationEndpoints,
  parseMiddlewareRequest,
  parseMiddlewareResponse,
  profileEndpoints,
  projectEndpoints,
  sessionEndpoints,
  settingsEndpoints,
  skillEndpoints,
  terminalEndpoints,
  topicEndpoints,
} from "./index"

const timestamp = "2026-04-17T09:00:00.000Z"

type RepresentativeParser = {
  endpoint: EndpointContract
  request?: unknown
  response?: unknown
  requestAssert?: (parsed: any) => void
  responseAssert?: (parsed: any) => void
}

const representativeParsers: Record<string, RepresentativeParser> = {
  profiles: {
    endpoint: profileEndpoints[1],
    request: {
      name: "Laptop",
      mode: "local",
      gatewayUrl: "ws://localhost:4545",
      workspaceRoot: "/workspace",
    },
    requestAssert: (parsed: { name: string }) => expect(parsed.name).toBe("Laptop"),
  },
  projects: {
    endpoint: projectEndpoints[1],
    request: {
      name: "Jarvis Desktop",
      profileId: "prof_local",
      workspaceRoot: "/workspace/Jarvis",
    },
    response: {
      project: {
        id: "proj_1",
        name: "Jarvis Desktop",
        profileId: "prof_local",
        workspaceRoot: "/workspace/Jarvis",
        archived: false,
        unreadCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    requestAssert: (parsed: { name: string }) => expect(parsed.name).toBe("Jarvis Desktop"),
    responseAssert: (parsed: { project: { id: string } }) => expect(parsed.project.id).toBe("proj_1"),
  },
  topics: {
    endpoint: topicEndpoints[1],
    request: { projectId: "proj_1", name: "Deploy flow" },
    requestAssert: (parsed: { name: string }) => expect(parsed.name).toBe("Deploy flow"),
  },
  navigation: {
    endpoint: navigationEndpoints[0],
    response: {
      project: { id: "proj_1", name: "Jarvis" },
      topics: [],
      agents: [],
      sessions: [],
      sessionVisibility: "jarvis-only",
    },
    responseAssert: (parsed: { project: { name: string } }) => expect(parsed.project.name).toBe("Jarvis"),
  },
  sessions: {
    endpoint: sessionEndpoints[0],
    response: {
      sessions: [
        {
          key: "sess_1",
          agentId: "main",
          label: "Debug auth",
          status: "running",
          createdAt: timestamp,
          updatedAt: timestamp,
          source: "jarvis",
        },
      ],
      sessionVisibility: "jarvis-only",
    },
    responseAssert: (parsed: { sessions: Array<{ key: string }> }) => expect(parsed.sessions[0]?.key).toBe("sess_1"),
  },
  chat: {
    endpoint: chatEndpoints[1],
    request: {
      sessionKey: "sess_1",
      text: "hello",
      attachments: [{ name: "notes.txt", mimeType: "text/plain" }],
    },
    response: {
      accepted: true,
      runId: "run_1",
      status: "started",
      sessionKey: "sess_1",
    },
    requestAssert: (parsed: { attachments?: Array<{ name: string }> }) => expect(parsed.attachments?.[0]?.name).toBe("notes.txt"),
    responseAssert: (parsed: { runId?: string | null }) => expect(parsed.runId).toBe("run_1"),
  },
  chatStream: {
    endpoint: chatEndpoints[3],
    response: {
      type: "chat.tool",
      sessionKey: "sess_1",
      runId: "run_1",
      verboseLevel: "full",
      toolOutputVisibility: "full",
      phase: "result",
      name: "exec",
      toolCallId: "tool_1",
      args: { command: "printf hi" },
      partialResult: null,
      result: { content: [{ type: "text", text: "hi" }] },
      error: null,
    },
    responseAssert: (parsed: { type: string; toolOutputVisibility?: string }) => {
      expect(parsed.type).toBe("chat.tool")
      expect(parsed.toolOutputVisibility).toBe("full")
    },
  },
  files: {
    endpoint: fileEndpoints[1],
    response: {
      file: {
        path: "/src/index.ts",
        content: "export const ok = true\n",
        encoding: "utf8",
      },
    },
    responseAssert: (parsed: { file: { path: string } }) => expect(parsed.file.path).toBe("/src/index.ts"),
  },
  git: {
    endpoint: gitEndpoints[5],
    response: {
      ok: true,
      commit: {
        sha: "abc1234",
        title: "Add contract tests",
        author: "Jarvis",
        committedAt: timestamp,
      },
    },
    responseAssert: (parsed: { commit: { sha: string } }) => expect(parsed.commit.sha).toBe("abc1234"),
  },
  terminal: {
    endpoint: terminalEndpoints[0],
    response: {
      terminal: {
        id: "term_1",
        projectId: "proj_1",
        title: "Shell",
        cwd: "/workspace",
        status: "running",
        lastActiveAt: timestamp,
      },
    },
    responseAssert: (parsed: { terminal: { id: string } }) => expect(parsed.terminal.id).toBe("term_1"),
  },
  activity: {
    endpoint: activityEndpoints[2],
    response: {
      roots: [
        {
          id: "agent_1",
          label: "Coordinator",
          status: "running",
          children: [{ id: "agent_2", label: "Worker", status: "done", children: [] }],
        },
      ],
    },
    responseAssert: (parsed: { roots: Array<{ children: unknown[] }> }) => expect(parsed.roots[0]?.children).toHaveLength(1),
  },
  adminAccess: {
    endpoint: adminAccessEndpoints[0],
    request: { actionId: "sessions.delete", actionLabel: "Delete a session" },
    response: {
      status: "needs_admin",
      title: "Admin access needed",
      message: "To delete a session, this device needs extra permission.",
      primaryActionLabel: "Approve admin access",
      secondaryActionLabel: "Not now",
      requestPath: "/api/admin-access/approve",
      showApproverPickerByDefault: false,
      recommendedApprovers: [{ id: "owner", name: "Workspace owner", role: "Fastest approver" }],
      retry: { gatewayMethod: "sessions.delete", label: "delete a session" },
    },
    requestAssert: (parsed: { actionId: string }) => expect(parsed.actionId).toBe("sessions.delete"),
    responseAssert: (parsed: { retry: { gatewayMethod: string } }) => expect(parsed.retry.gatewayMethod).toBe("sessions.delete"),
  },
  inbox: {
    endpoint: inboxEndpoints[2],
    response: {
      unread: {
        inboxUnreadCount: 1,
        topicUnreadCount: 1,
        projectUnreadCount: 2,
      },
    },
    responseAssert: (parsed: { unread: { projectUnreadCount: number } }) => expect(parsed.unread.projectUnreadCount).toBe(2),
  },
  memory: {
    endpoint: memoryEndpoints[3],
    response: { hits: [{ path: "MEMORY.md", snippet: "hello", score: 0.9 }] },
    responseAssert: (parsed: { hits: Array<{ path: string }> }) => expect(parsed.hits[0]?.path).toBe("MEMORY.md"),
  },
  settings: {
    endpoint: settingsEndpoints[3],
    request: { showExistingSessions: true, sessionVisibility: "all-visible", uiMode: "mission-control" },
    requestAssert: (parsed: { uiMode?: string }) => expect(parsed.uiMode).toBe("mission-control"),
  },
  skills: {
    endpoint: skillEndpoints[1],
    request: { source: "clawhub", slug: "openclaw-cli", scope: "user" },
    response: {
      status: "installed",
      skill: {
        id: "clawhub:openclaw-cli",
        slug: "openclaw-cli",
        name: "OpenClaw CLI",
        summary: "Operate OpenClaw",
        description: null,
        source: "clawhub",
        version: "1.0.0",
        installed: true,
        installSource: "clawhub",
        repoUrl: null,
        homepageUrl: null,
        localPath: "/root/.openclaw/skills/openclaw-cli",
        tags: ["openclaw"],
      },
      location: {
        scope: "user",
        root: "/root/.openclaw/skills",
        path: "/root/.openclaw/skills/openclaw-cli",
      },
      actions: ["clawhub install openclaw-cli"],
      warnings: [],
    },
    requestAssert: (parsed: { slug?: string }) => expect(parsed.slug).toBe("openclaw-cli"),
    responseAssert: (parsed: { skill: { slug: string } }) => expect(parsed.skill.slug).toBe("openclaw-cli"),
  },
  approvals: {
    endpoint: approvalEndpoints[1],
    request: { approvalId: "appr_1", decision: "allow-once" },
    response: { ok: true, approvalId: "appr_1", decision: "allow-once" },
    requestAssert: (parsed: { decision: string }) => expect(parsed.decision).toBe("allow-once"),
    responseAssert: (parsed: { decision: string }) => expect(parsed.decision).toBe("allow-once"),
  },
  bootstrap: {
    endpoint: bootstrapEndpoints[1],
    response: {
      run: { id: "run_1", profileId: "prof_1", status: "planned" },
      plannedSteps: ["detect", "install"],
    },
    responseAssert: (parsed: { plannedSteps: string[] }) => expect(parsed.plannedSteps).toHaveLength(2),
  },
} as const

describe("middleware contract registry", () => {
  it("keeps operation ids unique and registry entries in sync", () => {
    const operationIds = middlewareContracts.map((contract) => contract.operationId)

    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(middlewareOperationIds).toEqual(operationIds)

    for (const contract of middlewareContracts) {
      expect(middlewareContractRegistry[contract.operationId]).toBe(contract)
    }
  })

  it("exposes valid transport metadata for every contract", () => {
    for (const contract of middlewareContracts) {
      expect(contract.method).match(/GET|POST|PATCH|PUT|DELETE/)
      expect(contract.path.startsWith("/api/")).toBe(true)
      expect(contract.request).toBeTruthy()
      expect(contract.response).toBeTruthy()
    }
  })
})

describe("representative middleware contracts", () => {
  for (const [groupName, sample] of Object.entries(representativeParsers)) {
    it(`validates ${groupName} request payloads`, () => {
      if (!sample.request) return

      sample.requestAssert?.(parseMiddlewareRequest(sample.endpoint.request, sample.request) as never)
    })

    it(`validates ${groupName} response payloads`, () => {
      if (!sample.response) return

      sample.responseAssert?.(parseMiddlewareResponse(sample.endpoint.response, sample.response) as never)
    })
  }
})
