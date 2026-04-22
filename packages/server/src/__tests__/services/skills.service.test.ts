import { jest } from "@jest/globals"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import * as skills from "../../services/skills.service.js"
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

  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-skill-test-"))
  jest
    .spyOn(os, "homedir")
    .mockReturnValue(tempHome)
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

describe("skillsDiscover", () => {
  it("returns builtin skills catalog", () => {
    const result = skills.skillsDiscover()
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.sources).toContain("builtin")

    const slugs = result.results.map((r) => r.slug)
    expect(slugs).toContain("code-review")
    expect(slugs).toContain("git-commit")
    expect(slugs).toContain("test-gen")
  })

  it("filters by query", () => {
    const result = skills.skillsDiscover({ query: "code" })
    expect(result.results.length).toBeGreaterThan(0)
    for (const r of result.results) {
      const combined = `${r.name} ${r.slug} ${r.description}`.toLowerCase()
      expect(combined).toContain("code")
    }
    expect(result.query).toBe("code")
  })

  it("filters by query (case-insensitive)", () => {
    const result = skills.skillsDiscover({ query: "CODE" })
    expect(result.results.length).toBeGreaterThan(0)
  })

  it("returns empty results for non-matching query", () => {
    const result = skills.skillsDiscover({
      query: "zzz_nonexistent_skill_zzz",
    })
    expect(result.results).toEqual([])
  })

  it("respects limit", () => {
    const result = skills.skillsDiscover({ limit: 2 })
    expect(result.results.length).toBeLessThanOrEqual(2)
  })

  it("discovers local skills", () => {
    const skillsDir = path.join(
      tempHome,
      ".openclaw",
      "skills",
      "my-skill",
    )
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillsDir, "SKILL.md"),
      "---\nname: My Skill\ndescription: A test skill\n---\n# My Skill\n",
    )

    const result = skills.skillsDiscover({ includeLocal: true })
    const local = result.results.filter((r) => r.source === "local")
    expect(local.length).toBeGreaterThanOrEqual(1)
    expect(local[0].name).toBe("My Skill")
    expect(local[0].description).toBe("A test skill")
    expect(result.sources).toContain("local")
  })

  it("adds warning for clawhub and github probe", () => {
    const result = skills.skillsDiscover({
      includeClawHub: true,
      includeGithubProbe: true,
    })
    expect(result.warnings.length).toBe(2)
    expect(result.warnings[0]).toContain("ClawHub")
    expect(result.warnings[1]).toContain("GitHub")
  })
})

describe("parseSkillFrontmatter", () => {
  it("parses name and description from frontmatter", () => {
    const raw = "---\nname: Test\ndescription: A test\n---\n# Content"
    const result = skills.parseSkillFrontmatter(raw)
    expect(result.name).toBe("Test")
    expect(result.description).toBe("A test")
  })

  it("returns empty object for no frontmatter", () => {
    const raw = "# Just a heading\nSome content"
    const result = skills.parseSkillFrontmatter(raw)
    expect(result.name).toBeUndefined()
    expect(result.description).toBeUndefined()
  })

  it("handles partial frontmatter (name only)", () => {
    const raw = "---\nname: OnlyName\n---\n"
    const result = skills.parseSkillFrontmatter(raw)
    expect(result.name).toBe("OnlyName")
    expect(result.description).toBeUndefined()
  })

  it("handles partial frontmatter (description only)", () => {
    const raw = "---\ndescription: Desc only\n---\n"
    const result = skills.parseSkillFrontmatter(raw)
    expect(result.name).toBeUndefined()
    expect(result.description).toBe("Desc only")
  })
})

describe("skillsInstall", () => {
  it("installs a local skill", () => {
    const localSkillDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "jarvis-local-skill-"),
    )
    fs.writeFileSync(
      path.join(localSkillDir, "SKILL.md"),
      "---\nname: Local Skill\ndescription: Locally installed\n---\n",
    )

    try {
      const result = skills.skillsInstall({
        source: "local",
        localPath: localSkillDir,
        slug: "local-test",
        scope: "user",
      })
      expect(result.status).toBe("installed")
      expect(result.skill.name).toBe("Local Skill")
      expect(result.skill.slug).toBe("local-test")
      expect(result.location).toContain("local-test")
    } finally {
      fs.rmSync(localSkillDir, { recursive: true, force: true })
    }
  })

  it("rejects local install without localPath", () => {
    expect(() =>
      skills.skillsInstall({ source: "local" }),
    ).toThrow("localPath is required")
  })

  it("rejects local install for nonexistent path", () => {
    expect(() =>
      skills.skillsInstall({
        source: "local",
        localPath: "/nonexistent/path/xyz",
      }),
    ).toThrow("Local path not found")
  })

  it("rejects local install without SKILL.md", () => {
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "jarvis-empty-skill-"),
    )
    try {
      expect(() =>
        skills.skillsInstall({
          source: "local",
          localPath: emptyDir,
        }),
      ).toThrow("No SKILL.md found")
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it("rejects duplicate install without force", () => {
    const localSkillDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "jarvis-dup-skill-"),
    )
    fs.writeFileSync(
      path.join(localSkillDir, "SKILL.md"),
      "---\nname: Dup\n---\n",
    )

    try {
      skills.skillsInstall({
        source: "local",
        localPath: localSkillDir,
        slug: "dup-skill",
        scope: "user",
      })
      expect(() =>
        skills.skillsInstall({
          source: "local",
          localPath: localSkillDir,
          slug: "dup-skill",
          scope: "user",
        }),
      ).toThrow("already installed")
    } finally {
      fs.rmSync(localSkillDir, { recursive: true, force: true })
    }
  })

  it("allows duplicate install with force", () => {
    const localSkillDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "jarvis-force-skill-"),
    )
    fs.writeFileSync(
      path.join(localSkillDir, "SKILL.md"),
      "---\nname: Forced\n---\n",
    )

    try {
      skills.skillsInstall({
        source: "local",
        localPath: localSkillDir,
        slug: "force-skill",
        scope: "user",
      })
      const result = skills.skillsInstall({
        source: "local",
        localPath: localSkillDir,
        slug: "force-skill",
        scope: "user",
        force: true,
      })
      expect(result.status).toBe("installed")
    } finally {
      fs.rmSync(localSkillDir, { recursive: true, force: true })
    }
  })

  it("throws for clawhub source", () => {
    expect(() =>
      skills.skillsInstall({ source: "clawhub", slug: "test" }),
    ).toThrow("ClawHub skill installation not yet implemented")
  })

  it("throws for github source", () => {
    expect(() =>
      skills.skillsInstall({
        source: "github",
        repoUrl: "https://github.com/test/test",
      }),
    ).toThrow("GitHub skill installation not yet implemented")
  })

  it("throws for unsupported source", () => {
    expect(() =>
      skills.skillsInstall({ source: "npm" }),
    ).toThrow("Unsupported skill source")
  })
})

describe("skillsInstalled (Gateway)", () => {
  it("returns installed skills from gateway", async () => {
    const result = await skills.skillsInstalled({})
    expect(result).toBeDefined()
  })

  it("accepts optional agentId", async () => {
    const result = await skills.skillsInstalled({
      agentId: "main",
    })
    expect(result).toBeDefined()
  })

  it("works with no args", async () => {
    const result = await skills.skillsInstalled()
    expect(result).toBeDefined()
  })
})

describe("skillsSearchHub (Gateway)", () => {
  it("searches ClawHub skills", async () => {
    const result = await skills.skillsSearchHub({
      query: "code",
    })
    expect(result).toBeDefined()
    expect(result).toHaveProperty("results")
  })

  it("respects limit parameter", async () => {
    const result = await skills.skillsSearchHub({
      query: "test",
      limit: 5,
    })
    expect(result).toBeDefined()
  })

  it("works with no args", async () => {
    const result = await skills.skillsSearchHub()
    expect(result).toBeDefined()
  })
})

describe("commandsList (Gateway)", () => {
  it("lists all available commands", async () => {
    const result = await skills.commandsList({})
    expect(result).toBeDefined()
    expect(result).toHaveProperty("commands")
    expect(Array.isArray(result!.commands)).toBe(true)
  })

  it("includes command metadata", async () => {
    const result = await skills.commandsList({
      includeArgs: true,
    })
    expect(result).toBeDefined()
    if (result!.commands.length > 0) {
      const cmd = result!.commands[0]
      expect(cmd).toHaveProperty("name")
      expect(cmd).toHaveProperty("description")
      expect(cmd).toHaveProperty("source")
    }
  })

  it("filters by scope", async () => {
    const result = await skills.commandsList({
      scope: "native",
    })
    expect(result).toBeDefined()
  })

  it("filters by agentId", async () => {
    const result = await skills.commandsList({
      agentId: "main",
    })
    expect(result).toBeDefined()
  })
})

describe("toolsCatalog (Gateway)", () => {
  it("returns tool catalog grouped by category", async () => {
    const result = await skills.toolsCatalog({})
    expect(result).toBeDefined()
    expect(result).toHaveProperty("groups")
    expect(result).toHaveProperty("profiles")
    expect(Array.isArray(result!.groups)).toBe(true)
  })

  it("includes tool details in groups", async () => {
    const result = await skills.toolsCatalog({})
    expect(result).toBeDefined()
    if (result!.groups.length > 0) {
      const group = result!.groups[0]
      expect(group).toHaveProperty("id")
      expect(group).toHaveProperty("label")
      expect(group).toHaveProperty("tools")
    }
  })

  it("filters by agentId", async () => {
    const result = await skills.toolsCatalog({
      agentId: "main",
    })
    expect(result).toBeDefined()
  })

  it("can exclude plugins", async () => {
    const result = await skills.toolsCatalog({
      includePlugins: false,
    })
    expect(result).toBeDefined()
  })
})
