import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals"
import { EventEmitter } from "node:events"

const mockRequest = jest.fn<
  Promise<{ ok: boolean; payload?: Record<string, unknown>; error?: { message?: string } }>,
  [string, Record<string, unknown>?]
>()

const mockGetChatHistory = jest.fn<
  Promise<{ messages?: Array<Record<string, unknown>> }>,
  [string]
>()

const ensureGatewayClient = jest.fn(async () => ({
  request: mockRequest,
}))
const gatewayEvents = new EventEmitter()

jest.unstable_mockModule("../../gateway/client.js", () => ({
  ensureGatewayClient,
  gatewayEvents,
}))

jest.unstable_mockModule("../../services/chat.service.js", () => ({
  chatEvents: new EventEmitter(),
}))

jest.unstable_mockModule("middleware", () => ({
  getChatHistory: mockGetChatHistory,
}))

let cronService: typeof import("../../services/cron.service.js")

beforeAll(async () => {
  cronService = await import("../../services/cron.service.js")
})

beforeEach(() => {
  mockRequest.mockReset()
  mockGetChatHistory.mockReset()
  ensureGatewayClient.mockClear()
  ensureGatewayClient.mockImplementation(async () => ({
    request: mockRequest,
  }))
})

describe("parseCronSchedule", () => {
  it("parses a valid 5-field cron expression", () => {
    const result = cronService.parseCronSchedule("*/5 * * * *")
    expect(result.kind).toBe("cron")
    expect(result.expr).toBe("*/5 * * * *")
  })

  it("parses a valid 6-field cron expression", () => {
    const result = cronService.parseCronSchedule("0 */5 * * * *")
    expect(result.kind).toBe("cron")
  })

  it("rejects empty schedule", () => {
    expect(() => cronService.parseCronSchedule("")).toThrow("cannot be empty")
  })

  it("rejects whitespace-only schedule", () => {
    expect(() => cronService.parseCronSchedule("   ")).toThrow("cannot be empty")
  })

  it("rejects too few fields", () => {
    expect(() => cronService.parseCronSchedule("* * *")).toThrow("expected 5-6 fields")
  })

  it("rejects too many fields", () => {
    expect(() => cronService.parseCronSchedule("* * * * * * *")).toThrow("expected 5-6 fields")
  })

  it("trims whitespace", () => {
    const result = cronService.parseCronSchedule("  0 12 * * *  ")
    expect(result.expr).toBe("0 12 * * *")
  })
})

describe("cron service API coverage", () => {
  it("cronListJobs rejects when gateway not connected", async () => {
    ensureGatewayClient.mockRejectedValueOnce(new Error("Gateway not connected. Start the OpenClaw Gateway first."))
    await expect(cronService.cronListJobs()).rejects.toThrow("Gateway not connected")
  })

  it("cronGetJob returns the matching normalized job", async () => {
    mockRequest.mockImplementation(async (method) => {
      if (method === "cron.list") {
        return {
          ok: true,
          payload: {
            jobs: [
              {
                jobId: "job-1",
                name: "Morning summary",
                schedule: { kind: "cron", expr: "0 9 * * *", timezone: "Asia/Kolkata" },
                sessionTarget: "isolated",
                payload: { message: "Send summary" },
                enabled: true,
              },
            ],
          },
        }
      }
      if (method === "cron.runs") {
        return { ok: true, payload: { runs: [] } }
      }
      return { ok: false, error: { message: `Unexpected method ${method}` } }
    })

    const result = await cronService.cronGetJob({ jobId: "job-1" })

    expect(result.job.jobId).toBe("job-1")
    expect(result.job.name).toBe("Morning summary")
    expect(result.job.schedule).toBe("0 9 * * *")
    expect(result.job.message).toBe("Send summary")
  })

  it("cronUpdateJob falls back to local override when gateway update variants fail", async () => {
    mockRequest.mockImplementation(async (method) => {
      if (method === "cron.update") {
        return { ok: false, error: { message: "unsupported update shape" } }
      }
      if (method === "cron.list") {
        return {
          ok: true,
          payload: {
            jobs: [
              {
                jobId: "job-2",
                name: "Original name",
                schedule: { kind: "cron", expr: "*/5 * * * *" },
                sessionTarget: "isolated",
                payload: { message: "Original prompt" },
                enabled: true,
              },
            ],
          },
        }
      }
      if (method === "cron.runs") {
        return { ok: true, payload: { runs: [] } }
      }
      return { ok: false, error: { message: `Unexpected method ${method}` } }
    })

    const result = await cronService.cronUpdateJob({
      jobId: "job-2",
      name: "Renamed job",
      message: "New prompt",
      enabled: false,
    })

    expect(result.job.jobId).toBe("job-2")
    expect(result.job.name).toBe("Renamed job")
    expect(result.job.message).toBe("New prompt")
    expect(result.job.enabled).toBe(false)
    expect(result.job.paused).toBe(true)
    expect(mockRequest).toHaveBeenCalledWith(
      "cron.update",
      expect.objectContaining({ id: "job-2" }),
    )
  })

  it("cronCreateJob sends the expected gateway payload", async () => {
    mockRequest.mockImplementation(async (method, params) => {
      if (method === "cron.add") {
        return {
          ok: true,
          payload: {
            jobId: "job-3",
            name: params?.name,
            schedule: params?.schedule,
            sessionTarget: params?.sessionTarget,
            payload: params?.payload,
            enabled: params?.enabled,
          },
        }
      }
      return { ok: false, error: { message: `Unexpected method ${method}` } }
    })

    const result = await cronService.cronCreateJob({
      name: "Standup reminder",
      scheduleType: "every",
      schedule: "10s",
      session: "isolated",
      message: "Ping the standup room",
      model: "openai/gpt-5.4",
      deliveryMode: "none",
    })

    expect(result.job.jobId).toBe("job-3")
    expect(mockRequest).toHaveBeenCalledWith(
      "cron.add",
      expect.objectContaining({
        name: "Standup reminder",
        sessionTarget: "isolated",
        enabled: true,
        delivery: { mode: "none" },
        payload: expect.objectContaining({
          message: "Ping the standup room",
          model: "openai/gpt-5.4",
        }),
      }),
    )
  })

  it("cronJobConversation falls back to the job session and returns history", async () => {
    mockRequest.mockImplementation(async (method) => {
      if (method === "cron.runs") {
        return { ok: true, payload: { runs: [] } }
      }
      if (method === "cron.list") {
        return {
          ok: true,
          payload: {
            jobs: [
              {
                jobId: "job-4",
                name: "Digest",
                schedule: { kind: "cron", expr: "0 8 * * *" },
                sessionTarget: "sess_123",
                payload: { message: "Send digest" },
                enabled: true,
              },
            ],
          },
        }
      }
      return { ok: false, error: { message: `Unexpected method ${method}` } }
    })
    mockGetChatHistory.mockResolvedValueOnce({
      messages: [{ id: "m1", role: "assistant", text: "Digest sent" }],
    })

    const result = await cronService.cronJobConversation({ jobId: "job-4" })

    expect(result.sessionKey).toBe("sess_123")
    expect(result.messages).toEqual([
      expect.objectContaining({ text: "Digest sent" }),
    ])
    expect(mockGetChatHistory).toHaveBeenCalledWith("sess_123")
  })

  it("cronDeleteJob falls back to alternate request shapes and keeps deleted jobs out of refreshed lists", async () => {
    mockRequest.mockImplementation(async (method, params) => {
      if (method === "cron.remove") {
        if ("id" in (params ?? {})) {
          return { ok: false, error: { message: "unsupported id payload" } }
        }
        return { ok: true, payload: { deleted: true } }
      }
      if (method === "cron.list") {
        return {
          ok: true,
          payload: {
            jobs: [
              {
                jobId: "job-del",
                name: "Delete me",
                schedule: { kind: "cron", expr: "0 9 * * *" },
                sessionTarget: "isolated",
                payload: { message: "cleanup" },
                enabled: true,
              },
            ],
          },
        }
      }
      if (method === "cron.runs") {
        return { ok: true, payload: { runs: [] } }
      }
      return { ok: false, error: { message: `Unexpected method ${method}` } }
    })

    const deleted = await cronService.cronDeleteJob({ jobId: "job-del" })
    const listed = await cronService.cronListJobs()

    expect(deleted).toEqual({ deleted: true, jobId: "job-del" })
    expect(mockRequest).toHaveBeenCalledWith("cron.remove", { id: "job-del" })
    expect(mockRequest).toHaveBeenCalledWith("cron.remove", { jobId: "job-del" })
    expect(listed.jobs.some((job) => job.jobId === "job-del")).toBe(false)
  })
})
