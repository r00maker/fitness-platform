/**
 * Applies a studio's look: colours and corners as CSS variables on the page, and its two
 * typefaces from Google Fonts. Everything in styles.css reads these variables, so one app
 * serves every studio.
 */
import { APP_FONTS, CORNER_RADII, type AppTheme } from "@studio/shared";

export function applyTheme(t: AppTheme, root: HTMLElement = document.documentElement) {
  const r = CORNER_RADII[t.corners];
  const vars: Record<string, string> = {
    "--bg": t.background,
    "--surface": t.surface,
    "--ink": t.ink,
    "--muted": t.muted,
    "--line": t.line,
    "--accent": t.accent,
    "--on-accent": t.onAccent,
    "--hi": t.highlight,
    "--r-s": `${r.small}px`,
    "--r-l": `${r.large}px`,
    "--display": `"${t.displayFont}", Georgia, serif`,
    "--body": `"${t.bodyFont}", system-ui, sans-serif`,
  };
  // Worked out here rather than with CSS color-mix(), so phones with older browsers get them too.
  vars["--accent-soft"] = mix(t.accent, t.surface, 0.11);
  vars["--hi-soft"] = mix(t.highlight, t.surface, 0.28);
  vars["--ink-soft"] = mix(t.ink, t.surface, 0.07);
  // Text on the highlight (the seal): white or the studio's text colour, whichever reads better.
  vars["--on-hi"] = contrast(t.highlight, "#FFFFFF") >= contrast(t.highlight, t.ink) ? "#FFFFFF" : t.ink;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.motif = t.motif;
  root.dataset.corners = t.corners;
  root.dataset.display = APP_FONTS[t.displayFont].kind;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.background);
  loadFonts([t.displayFont, t.bodyFont]);
}

/** `amount` of colour a over colour b, as hex. */
function mix(a: string, b: string, amount: number) {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v * amount + y[i]! * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const loaded = new Set<string>();
function loadFonts(names: (keyof typeof APP_FONTS)[]) {
  const want = [...new Set(names)].filter((n) => !loaded.has(n));
  if (!want.length) return;
  want.forEach((n) => loaded.add(n));
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${want.map((n) => `family=${APP_FONTS[n].css}`).join("&")}&display=swap`;
  document.head.appendChild(link);
}
