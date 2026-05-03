import { jest } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as skillsLocal from "../../services/skills-local.js"
import * as connection from "../../db/connection.js"

let testDbPath: string
let tempHome: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()

  tempHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "jarvis-uninstall-test-"),
  )
  jest.spyOn(os, "homedir").mockReturnValue(tempHome)
})

afterEach(() => {
  connection.closeDb()
  try {
    fs.unlinkSync(testDbPath)
  } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
  jest.restoreAllMocks()
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {}
})

describe("uninstallSkill", () => {
  it("removes an installed skill directory", () => {
    const skillsDir = path.join(
      tempHome,
      ".openclaw",
      "skills",
      "my-skill",
    )
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      "---\nname: My Skill\ndescription: test\n---\n# My Skill\n",
    )

    expect(skillsLocal.isSkillInstalled("my-skill")).toBe(true)

    const result = skillsLocal.uninstallSkill("my-skill")
    expect(result.removed).toBe(true)
    expect(result.slug).toBe("my-skill")
    expect(fs.existsSync(skillsDir)).toBe(false)
    expect(skillsLocal.isSkillInstalled("my-skill")).toBe(false)
  })

  it("returns removed=false for non-existent skill", () => {
    const result = skillsLocal.uninstallSkill("nonexistent")
    expect(result.removed).toBe(false)
    expect(result.slug).toBe("nonexistent")
  })

  it("removes skill from workspace scope too", () => {
    const wsDir = path.join(
      tempHome,
      ".openclaw",
      "workspace",
      "skills",
      "ws-skill",
    )
    fs.mkdirSync(wsDir, { recursive: true })
    fs.writeFileSync(
      path.join(wsDir, "SKILL.md"),
      "---\nname: WS Skill\n---\n# WS\n",
    )

    const result = skillsLocal.uninstallSkill("ws-skill")
    expect(result.removed).toBe(true)
    expect(fs.existsSync(wsDir)).toBe(false)
  })

  it("removes skill from catalog after uninstall", () => {
    const skillsDir = path.join(
      tempHome,
      ".openclaw",
      "skills",
      "catalog-skill",
    )
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      "---\nname: Cat Skill\ndescription: test\n---\n",
    )

    skillsLocal.addSkillToCatalog({
      slug: "catalog-skill",
      name: "Cat Skill",
      description: "test",
      source: "local",
      version: "1.0.0",
    })

    const catalogBefore = skillsLocal.getSkillCatalog()
    expect(
      catalogBefore.some((s) => s.slug === "catalog-skill"),
    ).toBe(true)

    skillsLocal.uninstallSkill("catalog-skill")

    const catalogAfter = skillsLocal.getSkillCatalog()
    expect(
      catalogAfter.some((s) => s.slug === "catalog-skill"),
    ).toBe(false)
  })
})
