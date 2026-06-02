import { defineConfig, devices } from "playwright/test"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120000,
  use: {
    baseURL: "http://localhost:3456",
    trace: "on",
    video: "on",
    headless: true,
    launchOptions: { args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"] },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
