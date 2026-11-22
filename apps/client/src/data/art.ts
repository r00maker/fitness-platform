/**
 * Banner artwork for the demo studios, drawn as SVG so the demo needs no photos.
 * Each studio's banners use its own shapes: leaves for Linden, waves for Tidal, an ensō
 * brush circle and a seal for Aizome.
 */
const svg = (body: string, bg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice"><rect width="800" height="400" fill="${bg}"/>${body}</svg>`)}`;

const leaf = (x: number, y: number, s: number, r: number, fill: string, vein: string) =>
  `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M0 0 C 40 -60 120 -70 170 -10 C 120 50 40 50 0 0 Z" fill="${fill}"/><path d="M4 0 C 60 -14 110 -16 166 -10" stroke="${vein}" stroke-width="3" fill="none" stroke-linecap="round"/></g>`;

export const ART = {
  lindenHoliday: svg(
    leaf(470, 250, 1.6, -28, "#2F5D46", "#B9CF7A") + leaf(560, 120, 1.1, 18, "#46775C", "#DCE7C3") + leaf(640, 300, 0.9, -60, "#B9CF7A", "#2F5D46") + leaf(700, 80, 0.7, 40, "#8FAF6A", "#EEF1EA") +
      `<circle cx="760" cy="360" r="120" fill="#DCE7C3" opacity=".55"/>`,
    "#DCE5D3",
  ),
  lindenFriend: svg(
    leaf(520, 230, 1.3, -10, "#B9CF7A", "#2F5D46") + leaf(560, 240, 1.3, 170, "#2F5D46", "#B9CF7A") + `<circle cx="140" cy="60" r="200" fill="#F6F8F1" opacity=".5"/>`,
    "#CFDCC2",
  ),
  tidalChallenge: svg(
    [0, 1, 2, 3, 4]
      .map((i) => `<path d="M-20 ${120 + i * 60} C 120 ${60 + i * 60}, 240 ${180 + i * 60}, 400 ${120 + i * 60} S 680 ${60 + i * 60}, 840 ${120 + i * 60}" stroke="${i % 2 ? "#FF8FCB" : "#FFFFFF"}" stroke-width="${18 - i * 2}" fill="none" stroke-linecap="round" opacity="${1 - i * 0.12}"/>`)
      .join(""),
    "#2B3BE8",
  ),
  tidalSocks: svg(
    `<circle cx="600" cy="200" r="190" fill="#FF8FCB"/><circle cx="600" cy="200" r="120" fill="#2B3BE8"/><circle cx="600" cy="200" r="54" fill="#FFFFFF"/>` +
      `<path d="M-20 330 C 140 280, 280 380, 460 320 S 760 280, 840 330" stroke="#2B3BE8" stroke-width="16" fill="none" stroke-linecap="round"/>`,
    "#FFD9EC",
  ),
  aizomeRetreat: svg(
    `<path d="M560 70 C 690 80 740 210 680 300 C 620 380 470 380 420 290 C 380 210 430 120 520 96" stroke="#2E3D73" stroke-width="30" fill="none" stroke-linecap="round" opacity=".92"/>` +
      `<rect x="700" y="300" width="56" height="56" fill="#C2412D"/><rect x="712" y="312" width="32" height="32" fill="none" stroke="#F3F1EA" stroke-width="4"/>`,
    "#E2E0DA",
  ),
  aizomeMorning: svg(
    `<rect x="0" y="250" width="800" height="150" fill="#2E3D73"/><circle cx="560" cy="250" r="110" fill="#C2412D"/><rect x="0" y="250" width="800" height="150" fill="#2E3D73" opacity=".88"/>` +
      [0, 1, 2].map((i) => `<line x1="${380 + i * 40}" y1="${300 + i * 26}" x2="${740 - i * 30}" y2="${300 + i * 26}" stroke="#ECEBE7" stroke-width="3" opacity=".5"/>`).join(""),
    "#ECEBE7",
  ),
};
