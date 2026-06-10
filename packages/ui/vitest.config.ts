import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "hooks/**/*.test.ts",
      "components/inspector/**/*.test.ts",
      "components/ChatView/**/*.test.ts",
    ],
  },
})
