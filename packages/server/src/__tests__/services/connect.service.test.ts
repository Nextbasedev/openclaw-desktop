import * as connect from "../../services/connect.service.js"

describe("connectStatus", () => {
  it("returns connection status", () => {
    const result = connect.connectStatus()
    expect(result).toHaveProperty("gatewayConfigured")
    expect(result).toHaveProperty("hasIdentity")
    expect(result).toHaveProperty("status")
  })
})

describe("connectTest", () => {
  it("returns test result", () => {
    const result = connect.connectTest()
    expect(result).toHaveProperty("ok")
  })
})

describe("connectReset", () => {
  it("returns ok", () => {
    const result = connect.connectReset()
    expect(result.ok).toBe(true)
  })
})
