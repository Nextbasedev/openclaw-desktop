import { describe, expect, it } from "vitest"
import { getWorkspaceFileIconKind } from "./WorkspaceTab"

describe("workspace file icons", () => {
  it("maps common workspace file extensions to specific icon kinds", () => {
    expect(getWorkspaceFileIconKind("dashboard_mobile.png")).toBe("image")
    expect(getWorkspaceFileIconKind("deploy-complete.sh")).toBe("shell")
    expect(getWorkspaceFileIconKind("discord-model-json-command.json")).toBe("json")
    expect(getWorkspaceFileIconKind("discord-model-json-bot.js")).toBe("code")
    expect(getWorkspaceFileIconKind("DEPLOYMENT_PACKAGE.md")).toBe("markdown")
    expect(getWorkspaceFileIconKind("figma-token.txt")).toBe("text")
  })
})
