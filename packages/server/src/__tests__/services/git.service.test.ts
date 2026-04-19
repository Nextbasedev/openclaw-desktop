import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { execSync } from "node:child_process"
import * as git from "../../services/git.service.js"
import * as profiles from "../../services/profiles.service.js"
import * as projects from "../../services/projects.service.js"
import * as connection from "../../db/connection.js"

let testDbPath: string

beforeEach(() => {
  testDbPath = path.join(
    os.tmpdir(),
    `jarvis-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

function createTestProject(workspaceRoot: string, repoRoot?: string) {
  const prof = profiles.profilesCreate({
    name: "TestProf",
    mode: "local",
    gatewayUrl: "http://localhost:18789",
    workspaceRoot: os.tmpdir(),
  }).profile
  return projects.projectsCreate({
    name: `Project-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profileId: prof.id,
    workspaceRoot,
    repoRoot,
  }).project
}

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-git-test-"))
  execSync("git init -b main", { cwd: dir })
  execSync("git config user.email test@test.com", { cwd: dir })
  execSync("git config user.name Test", { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n")
  execSync("git add . && git commit -m 'init'", { cwd: dir })
  return dir
}

describe("gitBranches", () => {
  it("returns branch info for a repo", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitBranches({ projectId: proj.id })
      expect(result.local).toContain("main")
      expect(result.current).toBe("main")
      expect(Array.isArray(result.remote)).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it("returns branch info using default branch name", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitBranches({ projectId: proj.id })
      expect(result.local.length).toBeGreaterThanOrEqual(1)
      expect(result.current).toBeTruthy()
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe("gitContext", () => {
  it("returns git context for a repo", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitContext({ projectId: proj.id })
      expect(result.hasGit).toBe(true)
      expect(result.currentBranch).toBeTruthy()
      expect(Array.isArray(result.uncommittedChanges)).toBe(true)
      expect(Array.isArray(result.recentCommits)).toBe(true)
      expect(result.recentCommits.length).toBeGreaterThanOrEqual(1)
      expect(Array.isArray(result.trackedBranches)).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it("returns hasGit: false for directory without .git", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-nogit-"))
    try {
      const proj = createTestProject(dir, dir)
      const result = git.gitContext({ projectId: proj.id })
      expect(result.hasGit).toBe(false)
      expect(result.currentBranch).toBeNull()
      expect(result.uncommittedChanges).toEqual([])
      expect(result.recentCommits).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("gitRemoteList", () => {
  it("returns remotes for a repo", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitRemoteList({ projectId: proj.id })
      expect(Array.isArray(result.remotes)).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe("gitRemoteAdd", () => {
  it("validates remoteName not starting with -", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      expect(() =>
        git.gitRemoteAdd({
          projectId: proj.id,
          remoteName: "-evil",
          remoteUrl: "https://github.com/test/repo.git",
        }),
      ).toThrow("Remote name must not start with '-'")
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it("validates URL protocol", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      expect(() =>
        git.gitRemoteAdd({
          projectId: proj.id,
          remoteName: "upstream",
          remoteUrl: "ftp://bad.url/repo.git",
        }),
      ).toThrow("Invalid remote URL")
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it("accepts valid https URL", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitRemoteAdd({
        projectId: proj.id,
        remoteName: "upstream",
        remoteUrl: "https://github.com/test/repo.git",
      })
      expect(result.ok).toBe(true)
      expect(result.remoteName).toBe("upstream")

      const list = git.gitRemoteList({ projectId: proj.id })
      const upstream = list.remotes.filter(
        (r) => r.name === "upstream",
      )
      expect(upstream.length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it("accepts valid git@ URL", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitRemoteAdd({
        projectId: proj.id,
        remoteName: "ssh-remote",
        remoteUrl: "git@github.com:test/repo.git",
      })
      expect(result.ok).toBe(true)
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe("gitSwitchBranch", () => {
  it("validates branchName not starting with -", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      expect(() =>
        git.gitSwitchBranch({
          projectId: proj.id,
          branchName: "-malicious",
        }),
      ).toThrow("Branch name must not start with '-'")
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })

  it("creates and switches to new branch", () => {
    const repo = createTempGitRepo()
    try {
      const proj = createTestProject(repo, repo)
      const result = git.gitSwitchBranch({
        projectId: proj.id,
        branchName: "feature-test",
        create: true,
      })
      expect(result.ok).toBe(true)
      expect(result.branch).toBe("feature-test")
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe("error handling", () => {
  it("throws for nonexistent project", () => {
    expect(() =>
      git.gitBranches({ projectId: "proj_nonexistent" }),
    ).toThrow("Project not found")
  })

  it("throws for nonexistent project in gitContext", () => {
    expect(() =>
      git.gitContext({ projectId: "proj_nonexistent" }),
    ).toThrow("Project not found")
  })

  it("throws for nonexistent project in gitRemoteList", () => {
    expect(() =>
      git.gitRemoteList({ projectId: "proj_nonexistent" }),
    ).toThrow("Project not found")
  })
})
