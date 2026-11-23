import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two pages: the app itself, and the showcase that puts three studios' versions side by side.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  // iOS 16.4+ (Safari's engine, used by every iOS browser and the iOS app) and Android 10+ with a
  // current Chrome WebView. Newer syntax is rewritten for those.
  build: { target: ["es2020", "safari16", "chrome100"], rollupOptions: { input: { app: resolve(__dirname, "index.html"), showcase: resolve(__dirname, "showcase.html") } } },
  test: { environment: "jsdom" },
} as Parameters<typeof defineConfig>[0]);
