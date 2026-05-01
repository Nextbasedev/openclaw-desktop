import { jest } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as connection from "../../db/connection.js"
import { skillsInstalledLocal } from "../../services/skills-installed.service.js"

let testDbPath: string
let tempHome: string

function createSkill(dir: string, slug: string, name: string, desc: string) {
  const skillDir = path.join(dir, slug)
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n${desc}\n`,
  )
}

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  process.env.JARVIS_TEST_DB_PATH = testDbPath
  connection.resetDb()
  tempHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "jarvis-installed-test-"),
  )
  jest.spyOn(os, "homedir").mockReturnValue(tempHome)
})

afterEach(() => {
  connection.closeDb()
  try { fs.unlinkSync(testDbPath) } catch {}
  delete process.env.JARVIS_TEST_DB_PATH
  jest.restoreAllMocks()
  try { fs.rmSync(tempHome, { recursive: true, force: true }) } catch {}
})

describe("skillsInstalledLocal", () => {
  it("returns all installed skills from disk", () => {
    const skillsDir = path.join(tempHome, ".openclaw", "skills")
    createSkill(skillsDir, "alpha", "Alpha", "First skill")
    createSkill(skillsDir, "beta", "Beta", "Second skill")

    const res = skillsInstalledLocal()
    expect(res.results).toHaveLength(2)
    expect(res.results.every((s) => s.installed)).toBe(true)
    expect(res.sources).toContain("local")
    expect(res.nextCursor).toBeNull()
  })

  it("filters by query on name and description", () => {
    const skillsDir = path.join(tempHome, ".openclaw", "skills")
    createSkill(skillsDir, "code-review", "Code Review", "Review code")
    createSkill(skillsDir, "test-gen", "Test Gen", "Generate tests")

    const byName = skillsInstalledLocal({ query: "code" })
    expect(byName.results).toHaveLength(1)
    expect(byName.results[0].slug).toBe("code-review")

    const byDesc = skillsInstalledLocal({ query: "generate" })
    expect(byDesc.results).toHaveLength(1)
    expect(byDesc.results[0].slug).toBe("test-gen")
  })

  it("sorts by name", () => {
    const skillsDir = path.join(tempHome, ".openclaw", "skills")
    createSkill(skillsDir, "zulu", "Zulu", "Last")
    createSkill(skillsDir, "alpha", "Alpha", "First")

    const res = skillsInstalledLocal({ sort: "name" })
    expect(res.results[0].slug).toBe("alpha")
    expect(res.results[1].slug).toBe("zulu")
  })

  it("returns empty when no skills installed", () => {
    const res = skillsInstalledLocal()
    expect(res.results).toHaveLength(0)
    expect(res.sources).toEqual([])
  })
})
