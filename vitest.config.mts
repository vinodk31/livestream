import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the React Server bundle; it's a no-op in tests.
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      AUTH_SECRET: "test-secret-that-is-definitely-longer-than-32-characters",
      APP_URL: "http://localhost:3000",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
