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
      SECRETS_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      META_APP_SECRET: "test-meta-app-secret",
      META_VERIFY_TOKEN: "test-verify-token",
      META_APP_ID: "1234567890",
    },
  },
});
