import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import request from "supertest"
import { app } from "../../index.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-integ-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
})

afterEach(() => {
  connection.closeDb()
  try {
    fs.unlinkSync(testDbPath)
  } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

async function ipc(command: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/ipc/${command}`).send(body)
}

describe("Integration: full user flow via HTTP", () => {
  it("profile → project → topic → session → attach → delete cascade", async () => {
    const profileRes = await ipc("middleware_profiles_create", {
      name: "Integration Profile",
      mode: "local",
      gatewayUrl: "http://localhost:18789",
      workspaceRoot: os.tmpdir(),
    })
    expect(profileRes.status).toBe(200)
    const profileId = profileRes.body.profile.id

    const projectRes = await ipc("middleware_projects_create", {
      name: "Integration Project",
      profileId,
      workspaceRoot: os.tmpdir(),
    })
    expect(projectRes.status).toBe(200)
    const projectId = projectRes.body.project.id

    const topicRes = await ipc("middleware_topics_create", {
      projectId,
      name: "Integration Topic",
    })
    expect(topicRes.status).toBe(200)
    const topicId = topicRes.body.topic.id

    const sessionRes = await ipc("middleware_sessions_create", {
      sessionKey: "integ-session-001",
      projectId,
      agentId: "test-agent",
      label: "Integration Session",
    })
    expect(sessionRes.status).toBe(200)

    const attachRes = await ipc("middleware_topics_attach_session", {
      topicId,
      sessionKey: "integ-session-001",
    })
    expect(attachRes.status).toBe(200)

    const sidebarRes = await ipc("middleware_projects_sidebar", {
      projectId,
    })
    expect(sidebarRes.status).toBe(200)
    expect(sidebarRes.body.topics.length).toBeGreaterThanOrEqual(1)

    const deleteRes = await ipc("middleware_projects_delete", {
      projectId,
    })
    expect(deleteRes.status).toBe(200)

    const listRes = await ipc("middleware_projects_list")
    expect(listRes.status).toBe(200)
    expect(listRes.body.projects.every((p: Record<string, unknown>) => p.id !== projectId)).toBe(true)
  })
})

describe("Integration: branching flow via HTTP", () => {
  it("create branch → list → get → delete", async () => {
    const profileRes = await ipc("middleware_profiles_create", {
      name: "Branch Profile",
      mode: "local",
      gatewayUrl: "http://localhost:18789",
      workspaceRoot: os.tmpdir(),
    })
    const profileId = profileRes.body.profile.id
    const projectRes = await ipc("middleware_projects_create", {
      name: "Branch Project",
      profileId,
      workspaceRoot: os.tmpdir(),
    })
    const projectId = projectRes.body.project.id

    const createRes = await ipc("middleware_branch_create", {
      sourceSessionKey: "integ-src-001",
      sourceMessageId: "msg-integ-001",
      projectId,
      branchName: "Test Branch",
      branchSessionKey: "integ-branch-001",
    })
    expect(createRes.status).toBe(200)
    expect(createRes.body.branch.id).toMatch(/^branch_/)

    const listRes = await ipc("middleware_branch_list", {
      sourceSessionKey: "integ-src-001",
    })
    expect(listRes.status).toBe(200)
    expect(listRes.body.branches.length).toBe(1)

    const getRes = await ipc("middleware_branch_get", {
      branchSessionKey: "integ-branch-001",
    })
    expect(getRes.status).toBe(200)
    expect(getRes.body.branch.branchSessionKey).toBe("integ-branch-001")

    const deleteRes = await ipc("middleware_branch_delete", {
      branchSessionKey: "integ-branch-001",
    })
    expect(deleteRes.status).toBe(200)
    expect(deleteRes.body.deleted).toBe(true)
  })
})

describe("Integration: onboarding flow via HTTP", () => {
  it("status → check deps → check gateway → flow", async () => {
    const statusRes = await ipc("middleware_onboarding_status")
    expect(statusRes.status).toBe(200)
    expect(statusRes.body.step).toBe("not_started")

    const depsRes = await ipc("middleware_onboarding_check_dependencies")
    expect(depsRes.status).toBe(200)
    expect(depsRes.body.dependencies.length).toBe(3)
    const nodeCheck = depsRes.body.dependencies.find(
      (d: { name: string }) => d.name === "node",
    )
    expect(nodeCheck.installed).toBe(true)

    const gatewayRes = await ipc("middleware_onboarding_check_gateway")
    expect(gatewayRes.status).toBe(200)
    expect(gatewayRes.body).toHaveProperty("hasConfig")

    const flowRes = await ipc("middleware_onboarding_flow")
    expect(flowRes.status).toBe(200)
    expect(flowRes.body.flow).toHaveProperty("steps")
    expect(flowRes.body.flow).toHaveProperty("nextStep")
    expect(flowRes.body.state.core.status).toHaveProperty("node")
  })

  it("onboarding core check detects environment", async () => {
    const coreRes = await ipc("middleware_onboarding_core", {
      action: "check",
    })
    expect(coreRes.status).toBe(200)
    expect(coreRes.body.action).toBe("check")
    expect(coreRes.body.status.node.installed).toBe(true)
    expect(typeof coreRes.body.canAutoFix).toBe("boolean")
  })

  it("onboarding providers lists available providers", async () => {
    const res = await ipc("middleware_onboarding_providers")
    expect(res.status).toBe(200)
    expect(res.body.count).toBeGreaterThan(0)
    const ids = res.body.providers.map((p: Record<string, unknown>) => p.id)
    expect(ids).toContain("anthropic")
    expect(ids).toContain("openai")
  })

  it("onboarding provider types returns schemas", async () => {
    const res = await ipc("middleware_onboarding_provider_types")
    expect(res.status).toBe(200)
    expect(res.body.version).toBe("2026-04-18")
    expect(res.body.providers.length).toBeGreaterThan(0)
  })

  it("onboarding provider details for anthropic", async () => {
    const res = await ipc("middleware_onboarding_provider_details", {
      providerId: "anthropic",
    })
    expect(res.status).toBe(200)
    expect(res.body.provider.id).toBe("anthropic")
    expect(res.body.provider.category).toBe("core")
  })
})

describe("Integration: runtime commands via HTTP", () => {
  it("runtime info returns server metadata", async () => {
    const res = await ipc("middleware_runtime_info")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("contractVersion")
    expect(res.body).toHaveProperty("transport")
  })

  it("bot name get/set roundtrip", async () => {
    const setRes = await ipc("middleware_openclaw_bot_name_set", {
      botName: "IntegBot",
    })
    expect(setRes.status).toBe(200)
    expect(setRes.body.botName).toBe("IntegBot")

    const getRes = await ipc("middleware_openclaw_bot_name_get")
    expect(getRes.status).toBe(200)
    expect(getRes.body.botName).toBe("IntegBot")
  })
})

describe("Integration: sync commands via HTTP", () => {
  it("sync status returns expected shape", async () => {
    const res = await ipc("middleware_sync_status")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("breakdown")
    expect(res.body).toHaveProperty("deviceId")
  })

  it("set device id and verify", async () => {
    const setRes = await ipc("middleware_sync_set_device_id", {
      deviceId: "integ-device-001",
    })
    expect(setRes.status).toBe(200)

    const statusRes = await ipc("middleware_sync_status")
    expect(statusRes.status).toBe(200)
    expect(statusRes.body.deviceId).toBe("integ-device-001")
  })
})

describe("Integration: sign out / delete account via HTTP", () => {
  it("sign out clears onboarding state", async () => {
    await ipc("middleware_onboarding_set_step", { step: "provider" })
    await ipc("middleware_openclaw_bot_name_set", { botName: "TestBot" })

    const signOutRes = await ipc("middleware_onboarding_sign_out")
    expect(signOutRes.status).toBe(200)
    expect(signOutRes.body.ok).toBe(true)

    const statusRes = await ipc("middleware_onboarding_status")
    expect(statusRes.body.step).toBe("not_started")
  })

  it("delete account clears all settings", async () => {
    await ipc("middleware_openclaw_bot_name_set", { botName: "ToClear" })

    const deleteRes = await ipc("middleware_onboarding_delete_account")
    expect(deleteRes.status).toBe(200)
    expect(deleteRes.body.ok).toBe(true)

    const botRes = await ipc("middleware_openclaw_bot_name_get")
    expect(botRes.body.botName).toBeNull()
  })
})

describe("Integration: error handling via HTTP", () => {
  it("returns 404 for unknown command", async () => {
    const res = await ipc("totally_fake_command")
    expect(res.status).toBe(404)
    expect(res.body.error).toContain("Unknown command")
  })

  it("returns 500 for validation errors", async () => {
    const res = await ipc("middleware_profiles_create", {
      name: "  ",
      mode: "local",
      gatewayUrl: "http://x",
      workspaceRoot: "/tmp",
    })
    expect(res.status).toBe(500)
    expect(res.body.error).toBeTruthy()
  })

  it("gateway-dependent commands are dispatched correctly", async () => {
    const res = await ipc("middleware_chat_send", {
      sessionKey: "nonexistent-key",
      text: "hello",
    })
    // If gateway is running, it dispatches and returns a result (200) or gateway error (500).
    // Either way the route handled it — no 404 or crash.
    expect([200, 500]).toContain(res.status)
  })
})
