/**
 * Only in the iOS and Android apps (Capacitor): the Android back button goes Back in the app
 * (and leaves it from a tab's first screen), and the status bar matches the studio's colours.
 * On the web this does nothing, and its code isn't even loaded.
 */
import type { AppTheme } from "@studio/shared";

export async function setUpNative(theme: AppTheme, back: () => boolean) {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return;
  const [{ App }, { StatusBar, Style }] = await Promise.all([import("@capacitor/app"), import("@capacitor/status-bar")]);
  document.documentElement.classList.add(`native-${Capacitor.getPlatform()}`);
  await App.addListener("backButton", () => {
    if (!back()) void App.minimizeApp();
  });
  // Light backgrounds get dark status-bar text, and the other way round.
  const light = parseInt(theme.background.slice(1, 3), 16) * 0.299 + parseInt(theme.background.slice(3, 5), 16) * 0.587 + parseInt(theme.background.slice(5, 7), 16) * 0.114 > 150;
  await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
  if (Capacitor.getPlatform() === "android") await StatusBar.setBackgroundColor({ color: theme.background }).catch(() => {});
}
