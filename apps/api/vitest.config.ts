import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://studio:studio@localhost:5432/studio_test",
      AUTH_DEV_SECRET: "test-secret-test-secret-test-secret-0123456789",
    },
  },
});
