# The marketing site

Four pages, plain HTML, CSS and JavaScript, no framework:

| Page | Source | What's on it |
|---|---|---|
| Home | `src/pages/index.html` | The timetable hero (books itself while you watch; tap a class to book or join the waitlist), Home's to-do list, WhatsApp / public holidays / shared packs / instructor pay, the three jobs, moving over in brief, prices in brief, founding studios and the walkthrough form (`#walkthrough`). |
| Product | `src/pages/product.html` | By job. **Run the studio**: plain-English warnings, the instructor's phone, everything else in the base plan. **Fill your classes**: journeys (win-back, intro offer, first class) you can switch on and off. **Run a brand**: the report by location. **On every plan**: Ask, and the service promises. |
| Pricing | `src/pages/pricing.html` | A price calculator (locations, own app, monthly or yearly) that picks the cheapest plan that fits, the three plans, the full comparison table and an FAQ (payments are covered there, briefly). |
| Switching | `src/pages/switching.html` | The four steps, the questions the check asks before a move, what comes across, and, for Mindbody, Momence, Glofox or a spreadsheet: how we get the data out, an example month for a studio with its own app, a side-by-side table in SGD (their published prices are where quotes start; what's decided on a sales call), where we're stronger and where they are. Then the questions to ask on any sales call, with our answers. |

Shared parts: `src/site.css` (tokens and shared styles), `src/site.js` (helpers and the phone menu), `src/partials/` (header, footer, and the closing "Book a walkthrough" band, placed with `{{close}}`).

`node build.mjs` writes `dist/<page>.html` (full pages to host) and `dist/artifact/` (the same pages, the home page without its document wrapper, for publishing as an artifact). `pnpm --filter @studio/site check` (needs Playwright) builds, takes screenshots of every page at desktop and phone sizes into `shots/`, and checks the links between pages and every interactive part.

Look: graphite with one pale steel-blue accent. Body text is Instrument Sans; headlines use `--display` in `src/site.css`, still Instrument Sans until a headline font is chosen from `fonts.html` (the options page: Inter Tight, Geist, Manrope, Schibsted Grotesk, Instrument Serif). To switch, set `--display` and add the family to the Google Fonts link in `build.mjs`. The product windows keep the product's own dark theme. The only motion that isn't started by the visitor is the home page's opening (the headline settles, the week fills up) and the location report's bars growing once; both are off with reduced motion.

Prices are in SGD and match `PLAN_INFO` in `packages/shared/src/features.ts`: change both together. Competitor facts on Switching come from `docs/MARKET_AND_LAUNCH.md` and `docs/MIGRATION_AND_HQ.md` (checked November 2026); re-check them before each launch and update the date. USD figures are shown in SGD at about 1.30; update that too.

All names, numbers and messages in the product windows are sample data.

## Placeholders to fill in

- **Brand name and logo:** every `<span class="bn">Brand</span>` and the `logo-ph` box (in `src/partials/header.html` and `footer.html`), and each page's `<title>`.
- **Where the form sends:** set `data-endpoint` on `<form id="join">` (home page) to an API route when the site is hosted. Without it, the form checks what's filled in and says it's a preview.
- **Photos and video:** none yet; the pages stand without them. Planned slots, when generated:
  - a slow, dim video behind the home timetable: a reformer studio at dusk, lamps on, no people in focus;
  - on Product, beside "Run the studio": three real-looking moments (an instructor with a client on a reformer, the front desk with a phone, a client checking in), natural light, no faces in sharp focus.
- **To confirm:** the reply promise ("within two working days"), the founding studios offer, "moved within a day", the WhatsApp cost wording, the Chinese New Year dates in the holidays example (6 and 7 February 2027), and our answer on leaving ("your data at no cost, and we'll help with the rest").
