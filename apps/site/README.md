# The marketing site

`src/page.html` is the whole site: one page, its own CSS and JavaScript, no framework. `node build.mjs` wraps it into `dist/index.html` (about 60 KB, plus two Google Fonts). `pnpm --filter @studio/site check` (needs Playwright) takes screenshots at desktop and phone sizes into `shots/` and checks that every interactive part responds.

## What's on it

1. **The timetable** (the hero): a week of classes that books itself while you watch; visitors can tap a class to book a spot or join the waitlist. The headline settles in and the week fills up once, on load; that's the only motion that isn't started by the visitor.
2. **Needs attention**: Home's to-do list, with the real wording from the product. Each button does the job and clears the line.
3. **Plain English warnings**: three real "please check" messages (booking late, a double-booked instructor, a closed day).
4. **Made for how studios here run**: the WhatsApp inbox, checkout with PayNow and the card fee, a shared couple's pack, instructor pay.
5. **Instructors on their phones**: the class list with a waiver gap and a health note; Mark everyone present.
6. **Moving over**: the four steps and an example of the "every row accounted for" report.
7. **Pricing**: the three plans (from `docs/MARKET_AND_LAUNCH.md`), a "how many locations" picker that points to the right plan, and monthly or yearly prices.
8. **Founding studios**: the pilot offer and the walkthrough form.

All names, numbers and messages in the product windows are sample data.

## Placeholders to fill in

- **Brand name and logo:** every `<span class="bn">Brand</span>` and the `logo-ph` box in the header. The `<title>` too.
- **Where the form sends:** set `data-endpoint` on `<form id="join">` to an API route when the site is hosted. Without it, the form checks what's filled in and says it's a preview.
- **Photos and video:** none yet. The page is designed to stand without them. Planned slots, when generated:
  - a slow, dim video behind the hero timetable: a reformer studio at dusk, lamps on, no people in focus;
  - a band between "Instructors" and "Moving over": three real-looking moments (an instructor with a client on a reformer, the front desk with a phone, a client checking in), natural light, no faces in sharp focus.
- **The reply promise** ("within two working days") and the founding studios offer are the team's to confirm.
