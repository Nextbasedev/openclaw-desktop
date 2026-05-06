import { describe, expect, it } from "vitest"
import { canRunSlashCommandWhileGenerating, getSlashCommandName, isStopSlashCommand } from "./controlSlashCommands"
import type { SlashCommand } from "@/hooks/useSlashCommands"

const commands: SlashCommand[] = [
  { name: "status", description: "Status", source: "native", scope: "native", acceptsArgs: false },
  { name: "model", description: "Switch model", source: "native", scope: "both", acceptsArgs: true },
  { name: "plan", description: "Plan", source: "native", scope: "text", acceptsArgs: true },
]

describe("control slash commands", () => {
  it("extracts slash command names without args", () => {
    expect(getSlashCommandName("/status")).toBe("status")
    expect(getSlashCommandName("  /model opus")).toBe("model")
    expect(getSlashCommandName("hello /status")).toBeNull()
  })

  it("allows native control commands while a response is generating", () => {
    expect(canRunSlashCommandWhileGenerating("/status", commands)).toBe(true)
    expect(canRunSlashCommandWhileGenerating("/model opus", commands)).toBe(true)
  })

  it("does not treat text prompt slash commands as non-interrupting controls", () => {
    expect(canRunSlashCommandWhileGenerating("/plan ship the UI", commands)).toBe(false)
  })

  it("recognizes stop as a direct abort command", () => {
    expect(isStopSlashCommand("/stop")).toBe(true)
    expect(isStopSlashCommand("/status")).toBe(false)
  })
})
