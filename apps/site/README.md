# The marketing site

Four pages, plain HTML, CSS and JavaScript, no framework:

| Page | Source | What's on it |
|---|---|---|
| Home | `src/pages/index.html` | The hero clip (a class added to the week), **A day at the studio** (7:00am to-do list, 12:20pm instructor check-in, 6:02pm WhatsApp, 11:59pm pay: on wide screens the list stays put while the clips stack as you scroll and only the one in front plays; on phones each clip sits under its step), closed days and shared packs, the three jobs, moving over in brief, prices in brief, founding studios and the walkthrough form (`#walkthrough`). |
| Product | `src/pages/product.html` | By job, each with a clip. **Run the studio**: a plain-English warning and its fix, the instructor's phone, everything else in the base plan. **Fill your classes**: the intro-offer journey. **Run a brand**: the report by location. **On every plan**: Ask, and the service promises. |
| Pricing | `src/pages/pricing.html` | A price calculator (locations, own app, monthly or yearly) that picks the cheapest plan that fits, the three plans, the full comparison table and an FAQ (payments are covered there, briefly). |
| Switching | `src/pages/switching.html` | The four steps, a clip of our team's check before a move (every row accounted for, then the import), what comes across, and, for Mindbody, Momence, Glofox or a spreadsheet: how we get the data out, an example month for a studio with its own app, a side-by-side table in SGD (their published prices are where quotes start; what's decided on a sales call), where we're stronger and where they are. Then the questions to ask on any sales call, with our answers. |

Shared parts: `src/site.css` (tokens and shared styles), `src/site.js` (helpers and the phone menu), `src/partials/` (header, footer, and the closing "Book a walkthrough" band, placed with `{{close}}`).

`node build.mjs` writes `dist/<page>.html` (full pages to host) and `dist/artifact/` (the same pages, the home page without its document wrapper, for publishing as an artifact), each with `media/` (the clips and their posters). `pnpm --filter @studio/site check` (needs Playwright) builds, takes screenshots of every page at desktop and phone sizes into `shots/`, and checks the links between pages and every interactive part.

Look: graphite with one pale steel-blue accent. Headlines and big numbers are Manrope (`--display`, chosen from the options in `fonts.html`); body text is Instrument Sans.

Motion (inspired by how diabrowser.com moves, in our own colours): pages fade in; each headline gets a band of light passing through it once as it comes into view; the day story stacks its windows on scroll; chat replies and Ask questions type themselves with a caret; the systems we move studios from drift past in two rows; a soft horizon sits under the hero; and a "Book a walkthrough" dock floats at the bottom once the hero has gone, stepping aside at the form and the closing band. Easing: `--ease-io` (sharp in-out) for things that travel, `--ease-out` for things that arrive. All of it is off with reduced motion. The product windows keep the product's own dark theme. 

Prices are in SGD and match `PLAN_INFO` in `packages/shared/src/features.ts`: change both together. Competitor facts on Switching come from `docs/MARKET_AND_LAUNCH.md` and `docs/MIGRATION_AND_HQ.md` (checked November 2026); re-check them before each launch and update the date. USD figures are shown in SGD at about 1.30; update that too.

All names, numbers and messages in the product windows are sample data.

## Placeholders to fill in

- **Brand name and logo:** every `<span class="bn">Brand</span>` and the `logo-ph` box (in `src/partials/header.html` and `footer.html`), and each page's `<title>`.
- **Where the form sends:** set `data-endpoint` on `<form id="join">` (home page) to an API route when the site is hosted. Without it, the form checks what's filled in and says it's a preview.
- **Photos and video:** none yet; the pages stand without them. Planned slots, when generated:
  - a slow, dim video behind the home timetable: a reformer studio at dusk, lamps on, no people in focus;
  - on Product, beside "Run the studio": three real-looking moments (an instructor with a client on a reformer, the front desk with a phone, a client checking in), natural light, no faces in sharp focus.
- **To confirm:** the reply promise ("within two working days"), the founding studios offer, "moved within a day", the WhatsApp cost wording, the Chinese New Year dates in the holidays example (6 and 7 February 2027), and our answer on leaving ("your data at no cost, and we'll help with the rest").

## The product clips

Every clip on the site is a real recording of the product, made from the clickable previews (`preview/studio-calendar-preview.html`, and `preview/hq-preview.html` for the data move), with their sample data. On film the sample studio is called **Linden Reformer Studio** (a made-up name; the preview itself still says Demo Studio).

- `media/shots.mjs` lists the shots: what to open, what to click and type, what to hide, and how to crop. `media/rec.mjs` records them: Chromium at twice the resolution, the preview-only controls hidden, waiver reminders kept out of shot, a cursor (or a touch dot on phones) that glides between real clicks, every painted frame captured, then ffmpeg crops, adds a slow zoom where set, fades the loop's ends, and writes an H.264 mp4 and a poster.
- `media/webm.sh` adds a VP9 WebM copy of each clip. Pages list the mp4 first and the WebM second; each browser plays the first it can (Playwright's Chromium, used by the checks, needs the WebM).
- `media/sheet.sh <name> <out.png>` makes a contact sheet of a clip for review.
- Re-record after the product changes: `NODE_PATH=<playwright's node_modules> node media/shots.mjs [name...]`, then `media/webm.sh`, then `node build.mjs`.
- On the page, clips load as they come near, play muted and looped while on screen, and pause off screen. With reduced motion they show their poster and a Play button (which brings up the controls).
