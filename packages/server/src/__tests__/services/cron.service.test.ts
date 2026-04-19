import { parseCronSchedule, cronListJobs } from "../../services/cron.service.js"

describe("parseCronSchedule", () => {
  it("parses a valid 5-field cron expression", () => {
    const result = parseCronSchedule("*/5 * * * *")
    expect(result.kind).toBe("cron")
    expect(result.expr).toBe("*/5 * * * *")
  })

  it("parses a valid 6-field cron expression", () => {
    const result = parseCronSchedule("0 */5 * * * *")
    expect(result.kind).toBe("cron")
  })

  it("rejects empty schedule", () => {
    expect(() => parseCronSchedule("")).toThrow("cannot be empty")
  })

  it("rejects whitespace-only schedule", () => {
    expect(() => parseCronSchedule("   ")).toThrow("cannot be empty")
  })

  it("rejects too few fields", () => {
    expect(() => parseCronSchedule("* * *")).toThrow("expected 5-6 fields")
  })

  it("rejects too many fields", () => {
    expect(() => parseCronSchedule("* * * * * * *")).toThrow("expected 5-6 fields")
  })

  it("trims whitespace", () => {
    const result = parseCronSchedule("  0 12 * * *  ")
    expect(result.expr).toBe("0 12 * * *")
  })
})

describe("gateway-dependent cron commands", () => {
  it("cronListJobs rejects when gateway not connected", async () => {
    await expect(cronListJobs()).rejects.toThrow("Gateway not connected")
  })
})
