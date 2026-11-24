/**
 * The client app's look, set per studio. Studios start from a preset and change what they like:
 * colours, the pair of typefaces (from a short list that reads well on phones), corner style,
 * how celebrations look, a welcome line and the class milestones the app counts towards.
 *
 * Custom looks come with the branded app (Signature, or Growth with the app add-on). Without it,
 * the app uses the "Classic" preset in the studio's booking-page colour.
 */
import { z } from "zod";

/** Typefaces the app can load (Google Fonts), each with what it's good for. */
export const APP_FONTS = {
  "Young Serif": { css: "Young+Serif", weights: [400], kind: "serif", note: "Soft, old-style serif for calm, crafted studios" },
  "Shippori Mincho": { css: "Shippori+Mincho:wght@500;700", weights: [500, 700], kind: "serif", note: "Fine, high-contrast serif with a quiet, Japanese feel" },
  "Bricolage Grotesque": { css: "Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800", weights: [400, 800], kind: "sans", note: "Punchy, characterful sans for energetic studios" },
  "Figtree": { css: "Figtree:wght@400;500;600;700", weights: [400, 700], kind: "sans", note: "Clear, friendly sans for body text" },
  "Zen Kaku Gothic New": { css: "Zen+Kaku+Gothic+New:wght@400;500;700", weights: [400, 700], kind: "sans", note: "Even, open sans that pairs with Mincho" },
  "Manrope": { css: "Manrope:wght@400;500;600;700;800", weights: [400, 800], kind: "sans", note: "Neat, modern sans" },
} as const;
export type AppFont = keyof typeof APP_FONTS;
const FONT_NAMES = Object.keys(APP_FONTS) as [AppFont, ...AppFont[]];

/** How celebrations look: a leaf unfurling, a wave, or a seal stamped on the card. */
export const APP_MOTIFS = ["leaf", "wave", "stamp", "spark"] as const;
export type AppMotif = (typeof APP_MOTIFS)[number];
export const APP_CORNERS = ["square", "soft", "round"] as const;
export type AppCorners = (typeof APP_CORNERS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #2F5D46.");
export const appThemeSchema = z.object({
  preset: z.string().max(40),
  /** Page background, cards, text, quieter text, lines. */
  background: hex,
  surface: hex,
  ink: hex,
  muted: hex,
  line: hex,
  /** The brand colour (buttons, progress) and the text colour that sits on it. */
  accent: hex,
  onAccent: hex,
  /** A second colour for highlights (achievements, the next milestone). */
  highlight: hex,
  displayFont: z.enum(FONT_NAMES),
  bodyFont: z.enum(FONT_NAMES),
  corners: z.enum(APP_CORNERS),
  motif: z.enum(APP_MOTIFS),
  /** Shown under the greeting on Home, e.g. "Breathe in. You showed up." */
  welcome: z.string().trim().max(120).nullable(),
  /** Class counts the app celebrates, smallest first. */
  milestones: z.array(z.number().int().min(1).max(5000)).min(1).max(12),
});
export type AppTheme = z.infer<typeof appThemeSchema>;
/** What a studio sends to change its look: any part of it. */
export const appThemeUpdate = appThemeSchema.partial().strict();

export const DEFAULT_MILESTONES = [10, 20, 50, 100, 150, 200, 300, 500, 1000];

/** Starting points, named for their colours. Each is a complete look that studios then change. */
export const APP_THEME_PRESETS: Record<string, AppTheme & { label: string; description: string }> = {
  classic: {
    preset: "classic", label: "Classic", description: "Clean and neutral, in your booking-page colour.",
    background: "#F4F5F7", surface: "#FFFFFF", ink: "#171B21", muted: "#5D6673", line: "#E1E4E9",
    accent: "#0C6156", onAccent: "#FFFFFF", highlight: "#E9B949",
    displayFont: "Manrope", bodyFont: "Manrope", corners: "soft", motif: "spark", welcome: null, milestones: DEFAULT_MILESTONES,
  },
  sage: {
    preset: "sage", label: "Sage", description: "Calm and botanical: sage and deep green, a soft serif and leaf-shaped badges.",
    background: "#EEF1EA", surface: "#FBFCF8", ink: "#1B2A21", muted: "#5B6B60", line: "#D9E0D2",
    accent: "#2F5D46", onAccent: "#F4F8EF", highlight: "#B9CF7A",
    displayFont: "Young Serif", bodyFont: "Figtree", corners: "soft", motif: "leaf", welcome: "Slow is still forward.", milestones: [10, 20, 50, 100, 150, 200, 300, 500],
  },
  cobalt: {
    preset: "cobalt", label: "Cobalt", description: "Bright and bold: cobalt and pink, a heavy sans-serif, pill shapes and badges with a ripple.",
    background: "#F3F4FF", surface: "#FFFFFF", ink: "#0F1238", muted: "#545A86", line: "#DCDFFA",
    accent: "#2B3BE8", onAccent: "#FFFFFF", highlight: "#FF8FCB",
    displayFont: "Bricolage Grotesque", bodyFont: "Bricolage Grotesque", corners: "round", motif: "wave", welcome: "Tuck, pulse, repeat.", milestones: [5, 20, 50, 100, 200, 500],
  },
  indigo: {
    preset: "indigo", label: "Indigo", description: "Still and exact: stone and indigo, a fine serif, square corners and a red seal for each achievement.",
    background: "#ECEBE7", surface: "#F8F7F4", ink: "#1E2030", muted: "#626473", line: "#D8D6D0",
    accent: "#2E3D73", onAccent: "#F3F1EA", highlight: "#C2412D",
    displayFont: "Shippori Mincho", bodyFont: "Zen Kaku Gothic New", corners: "square", motif: "stamp", welcome: "Arrive. Breathe. Begin.", milestones: [10, 25, 50, 108, 200, 500],
  },
};

/** The looks' earlier names (they were named after the example studios), for looks saved before. */
export const LEGACY_PRESET_KEYS: Record<string, string> = { studio: "classic", linden: "sage", tidal: "cobalt", aizome: "indigo" };
export const presetKey = (key: string | null | undefined) => (key ? LEGACY_PRESET_KEYS[key] ?? key : "classic");

/** The theme a studio's app uses: its saved look on top of its preset, or the plain preset in its colour. */
export function resolveAppTheme(saved: Partial<AppTheme> | null | undefined, opts: { hasApp: boolean; accent?: string | null }): AppTheme {
  const base = APP_THEME_PRESETS.classic!;
  if (!opts.hasApp || !saved) {
    const { label: _l, description: _d, ...t } = base;
    return { ...t, accent: opts.accent ?? t.accent };
  }
  const preset = APP_THEME_PRESETS[presetKey(saved.preset)] ?? base;
  const { label: _l, description: _d, ...t } = preset;
  const merged = { ...t, ...saved, preset: preset.preset };
  return { ...merged, milestones: [...new Set(merged.milestones)].sort((a, b) => a - b) };
}

/** Corner radii for each corner style: small things (chips, inputs) and large things (cards, sheets). */
export const CORNER_RADII: Record<AppCorners, { small: number; large: number; pill: boolean }> = {
  square: { small: 2, large: 4, pill: false },
  soft: { small: 10, large: 18, pill: false },
  round: { small: 999, large: 26, pill: true },
};
