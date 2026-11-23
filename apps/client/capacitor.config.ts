/**
 * The phone apps (iOS and Android) wrap the same web app with Capacitor. Each studio with the
 * branded app gets its own build: its own app id, name, colours and the studio it opens on.
 *
 *   STUDIO_SLUG=linden APP_ID=sg.studioapp.linden APP_NAME="Linden Reformer" \
 *     VITE_API_URL=https://api.studioapp.sg pnpm --filter @studio/client native:sync
 *
 * then open ios/ in Xcode or android/ in Android Studio to sign and upload. See docs/CLIENT_APP.md.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: process.env.APP_ID ?? "sg.studioapp.client",
  appName: process.env.APP_NAME ?? "Studio",
  webDir: "dist",
  // The app talks to the API over HTTPS; nothing is loaded from elsewhere.
  server: { androidScheme: "https", iosScheme: "https" },
  ios: { contentInset: "never", backgroundColor: process.env.APP_BACKGROUND ?? "#F4F5F7" },
  android: { backgroundColor: process.env.APP_BACKGROUND ?? "#F4F5F7", allowMixedContent: false },
  plugins: {
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
