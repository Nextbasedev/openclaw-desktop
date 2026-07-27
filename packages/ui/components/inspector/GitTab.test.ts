import { describe, expect, it } from "vitest"
import { getEffectiveGitTarget, parsePersistedGitTabSelection, type GitTabSelection } from "./GitTab"

describe("GitTab selection persistence", () => {
  it("keeps the manually selected repo as the effective git target when no project is active", () => {
    const selection: GitTabSelection = {
      projectId: null,
      repo: { name: "openclaw-desktop", path: "/workspace/openclaw-desktop" },
    }

    expect(getEffectiveGitTarget(null, selection)).toEqual({
      projectId: null,
      repoPath: "/workspace/openclaw-desktop",
    })
  })

  it("keeps the active project target above a manually selected repo", () => {
    const selection: GitTabSelection = {
      projectId: null,
      repo: { name: "openclaw-desktop", path: "/workspace/openclaw-desktop" },
    }

    expect(getEffectiveGitTarget("project-1", selection)).toEqual({
      projectId: "project-1",
      repoPath: null,
    })
  })

  it("restores a persisted repo selection", () => {
    expect(parsePersistedGitTabSelection(JSON.stringify({
      projectId: null,
      repo: { name: "openclaw-desktop", path: "/workspace/openclaw-desktop" },
    }))).toEqual({
      projectId: null,
      repo: { name: "openclaw-desktop", path: "/workspace/openclaw-desktop" },
    })
  })
})
