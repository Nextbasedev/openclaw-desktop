import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { commandRegistry } from "../../dispatch/registry.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(os.tmpdir(), `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
})

afterEach(() => {
  connection.closeDb()
  try { fs.unlinkSync(testDbPath) } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
})

describe("command registry", () => {
  it("has all runtime commands", () => {
    expect(commandRegistry.middleware_runtime_info).toBeDefined()
    expect(commandRegistry.middleware_openclaw_bot_name).toBeDefined()
    expect(commandRegistry.middleware_openclaw_bot_name_get).toBeDefined()
    expect(commandRegistry.middleware_openclaw_bot_name_set).toBeDefined()
    expect(commandRegistry.middleware_request_admin_access).toBeDefined()
    expect(commandRegistry.middleware_approve_admin_access).toBeDefined()
  })

  it("has all profile commands", () => {
    expect(commandRegistry.middleware_profiles_list).toBeDefined()
    expect(commandRegistry.middleware_profiles_create).toBeDefined()
    expect(commandRegistry.middleware_profiles_update).toBeDefined()
    expect(commandRegistry.middleware_profiles_delete).toBeDefined()
    expect(commandRegistry.middleware_profile_token_set).toBeDefined()
    expect(commandRegistry.middleware_profile_token_get).toBeDefined()
    expect(commandRegistry.middleware_profile_token_delete).toBeDefined()
  })

  it("has all environment commands", () => {
    expect(commandRegistry.middleware_environment_connect).toBeDefined()
    expect(commandRegistry.middleware_environment_status).toBeDefined()
    expect(commandRegistry.middleware_environment_detect).toBeDefined()
  })

  it("has all voice settings commands", () => {
    expect(commandRegistry.middleware_voice_settings_get).toBeDefined()
    expect(commandRegistry.middleware_voice_settings_set).toBeDefined()
  })

  it("has all project commands", () => {
    expect(commandRegistry.middleware_projects_list).toBeDefined()
    expect(commandRegistry.middleware_projects_create).toBeDefined()
    expect(commandRegistry.middleware_projects_get).toBeDefined()
    expect(commandRegistry.middleware_projects_update).toBeDefined()
    expect(commandRegistry.middleware_projects_archive).toBeDefined()
    expect(commandRegistry.middleware_projects_pin).toBeDefined()
    expect(commandRegistry.middleware_projects_delete).toBeDefined()
    expect(commandRegistry.middleware_projects_sidebar).toBeDefined()
  })

  it("has all topic commands", () => {
    expect(commandRegistry.middleware_topics_list).toBeDefined()
    expect(commandRegistry.middleware_topics_create).toBeDefined()
    expect(commandRegistry.middleware_topics_update).toBeDefined()
    expect(commandRegistry.middleware_topics_archive).toBeDefined()
    expect(commandRegistry.middleware_topics_delete).toBeDefined()
    expect(commandRegistry.middleware_topics_attach_session).toBeDefined()
    expect(commandRegistry.middleware_topics_detach_session).toBeDefined()
  })

  it("has all session commands", () => {
    expect(commandRegistry.middleware_sessions_list).toBeDefined()
    expect(commandRegistry.middleware_sessions_create).toBeDefined()
    expect(commandRegistry.middleware_sessions_update).toBeDefined()
    expect(commandRegistry.middleware_sessions_delete).toBeDefined()
  })

  it("all handlers are functions", () => {
    for (const [name, handler] of Object.entries(commandRegistry)) {
      expect(typeof handler).toBe("function")
    }
  })

  it("runtime_info returns expected shape", async () => {
    const result = await commandRegistry.middleware_runtime_info({})
    expect(result).toHaveProperty("contractVersion")
    expect(result).toHaveProperty("transport")
  })

  it("profiles_list returns expected shape", async () => {
    const result = await commandRegistry.middleware_profiles_list({})
    expect(result).toHaveProperty("profiles")
  })
})
