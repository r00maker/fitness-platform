# The marketing site

Four pages, plain HTML, CSS and JavaScript, no framework:

| Page | Source | What's on it |
|---|---|---|
| Home | `src/pages/index.html` | The headline over the hero film (plan the week, check them in, answer every message, pay the team, fill the next class), **A day at the studio** (one film in four chapters: 7:00am cover, 12:20pm check-in, 6:02pm WhatsApp, 11:59pm pay; the chapter buttons under it follow the film and jump to their part), the made-for-here film (closed days, shared packs), the three jobs, moving over in brief, prices in brief, founding studios and the walkthrough form (`#walkthrough`). |
| Product | `src/pages/product.html` | By job, each with a film and then everything else in it. **Run the studio**: a clash caught in plain English, check-in at the door. **Fill your classes**: the intro-offer journey. **Run a brand**: reports by location. **On every plan**: the service promises and an Ask film. |
| Pricing | `src/pages/pricing.html` | A price calculator (locations, own app, monthly or yearly) that picks the cheapest plan that fits, the three plans, the full comparison table and an FAQ (payments are covered there, briefly). |
| Switching | `src/pages/switching.html` | The four steps, a film of our team's check before a move (every row accounted for, anything unclear listed), what comes across, and, for Mindbody, Momence, Glofox or a spreadsheet: how we get the data out, an example month for a studio with its own app, a side-by-side table in SGD (their published prices are where quotes start; what's decided on a sales call), where we're stronger and where they are. Then the questions to ask on any sales call, with our answers. |

Shared parts: `src/site.css` (tokens and shared styles), `src/site.js` (helpers and the phone menu), `src/partials/` (header, footer, and the closing "Book a walkthrough" band, placed with `{{close}}`).

`node build.mjs` writes `dist/<page>.html` (full pages to host) and `dist/artifact/` (the same pages, the home page without its document wrapper, for publishing as an artifact), each with `media/` (the films and their posters). `pnpm --filter @studio/site check` (needs Playwright) builds, takes screenshots of every page at desktop and phone sizes into `shots/`, and checks the links between pages and every interactive part.

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

## The product films

The films are edited, not screen recordings: the camera pans and zooms between details of the real product, captions and labels point out what matters, and shots cut on the beat. Everything in them comes from the product itself: 2x captures of the clickable previews (`preview/studio-calendar-preview.html`, and `preview/hq-preview.html` for the data move) with their sample data, the studio shown as **Linden Reformer Studio** (a made-up name).

| Film | Where | What |
|---|---|---|
| `hero` | Home, top | Plan the week, check them in, answer every message, pay the team, fill the next class, then "One app for the whole studio." |
| `day` | Home | 7:00am, 12:20pm, 6:02pm, 11:59pm (chapters start at 0, 6.1, 12.1 and 18.1 seconds; the page's chapter buttons use the same times) |
| `here` | Home | Closing for a retreat and what it cancels; a family pack shared from the client's app |
| `run`, `fill`, `brand`, `ask` | Product | A clash caught in plain English and check-in; the intro-offer journey; locations side by side; Ask |
| `move` | Switching | Our team's check: every row accounted for, anything unclear listed |

How they're made:

1. `media/stills.mjs` captures the screens (`media/stills/<name>.png`, at 2x) and where each detail sits on them (`<name>.json`). It reuses `media/rec.mjs`, which opens the preview, hides the preview-only controls and waiver reminders, and swaps in the studio's name.
2. `media/film/films.js` scripts each film as a timeline: shots with camera keyframes (focus on a named detail, zoom, offset), captions, time stamps, callouts (a ring around a detail, with a label that moves with the camera) and an end card. `media/film/engine.js` turns a time into a frame; `media/film/stage.html` is the 1920x1080 canvas.
3. `media/film/render.mjs` steps through every frame at 30 fps and encodes `media/out/film-<name>.mp4` (H.264), `.webm` (VP9) and a poster. `--preview` makes a contact sheet of 12 moments per film in `media/.preview/` instead, for quick review.

```bash
NODE_PATH=<playwright's node_modules> node media/stills.mjs
```

```bash
NODE_PATH=<playwright's node_modules> node media/film/render.mjs
```

After the product changes, recapture the stills, check the previews, then render. On the page, films load as they come near, play muted and looped while on screen, and pause off screen; with reduced motion they show their poster and a Play button.
