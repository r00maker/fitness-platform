# The 14-day free trial

## What it is

The trial lasts 14 days, needs no card and has nothing to cancel. It's for trying the app, not for running a studio. A studio chooses the plan to try (Essentials, Growth or Signature) and which kind of trial it is.

| | New studio | Studio already on another system |
|---|---|---|
| What they get | Their real studio, on the plan they chose: classes, packages, team, booking page, the client app | A test studio filled with sample classes, instructors, clients and bookings |
| Payments | Can't connect Stripe; no online payments | Same |
| WhatsApp | Can't connect | Same |
| Clients | Up to 25 | 12 sample clients; up to 25 |
| Data move | Not needed | Not during the trial; we move their data when they sign up |
| Booking page | On | Off, and never public |
| Messages | Sent as normal | Nothing is sent to anyone (it's sample data) |
| When they start paying | The limits lift; everything they set up carries on | Our team sets up their real studio and moves their data as usual; the test studio is then ended |

When the 14 days are up, the studio is **read-only**: it can be looked at, but nothing can be changed or booked, for staff and clients alike. Its data is kept for 30 days. Our team can extend a trial, end it early, or (for a new studio) convert it once they're paying.

**Safeguards:**
- **One trial per person.** Someone who already owns a studio with us doesn't get one.
- **A confirmed email.** Throwaway inboxes are refused.
- **The terms are accepted at the start, and the version is recorded.** They say it's for trying the app, not for copying it or building a competing product.
- **Sign-ups are rate-limited.**

## How it's built

- **Shared:** `packages/shared/src/trial.ts` holds the kinds, 14 days, the 25-client limit and the terms.
- **API:** `apps/api/src/modules/trial/`.
  - **Routes:**
    - `GET /v1/public/trial`: the terms, for the sign-up page.
    - `POST /v1/trials`: start a trial. It needs a sign-in token but no studio.
    - `GET /v1/trial`: what the studio sees: days left, what's not included and the client count.
    - `POST /v1/trial/start-plan`: the owner asks to start their plan.
  - **HQ routes:**
    - `GET /v1/platform/trials`: grouped into new, existing, asked to start and converted.
    - `POST /v1/platform/studios/:id/trial`: `extend` (with `days`), `end` or `convert`.
  - **Where the limits are enforced:**
    - `onlineReady()`: no online payments.
    - `/payments/connect`.
    - `/whatsapp/settings`.
    - HQ's data-move routes.
    - `/join`: the client limit.
    - The public booking page: never for a test studio.
    - `notify()`: nothing sent for a test studio.
    - A pre-handler that makes an ended trial read-only.
  - **The test studio's sample data:** `trial/sandbox.ts`. Everyone in it has an example.com address.
- **Tests:** `apps/api/test/trial.test.ts`.
- **Preview:** the **Trial** control in the studio preview's header (`preview/src/mkt29.js`, checked by `tlcheck.cjs`). It shows the bar with the days left, payments locked, **Start my plan**, the test studio and the ended state.
- **Still to build:** the sign-up page on the website. It signs the person in, then calls `POST /v1/trials`.

## Is a free trial a good idea?

Yes, with the guardrails above. Studio owners are wary of switching, so letting them click around their own timetable answers most of their questions before a call. The trial isn't what gives your features away: anyone can already see them by booking a demo, by looking at the marketing site, or by becoming a client of one of your studios. The trial only lets them use the features for two weeks without being able to run on them. What a competitor can't copy from a trial is what makes this work:
- the data move done for them;
- support;
- Stripe, WhatsApp and PayNow set up locally;
- pricing they can see up front;
- how quickly you ship.

What would actually cost you is people running a small studio on an endless free trial. That's what the limits are for: no payments, a 25-client cap, read-only after 14 days, one trial per person.

**Recommendation:**
- Offer the trial to studios that sign up on the website.
- Keep the founding-studio offer and walkthroughs for serious leads.
- Watch the HQ trials list: "asked to start" is your hottest pipeline.

## Keeping the code safe

What's already true:
- **The server code never leaves the server.** The API (pricing, rules, payroll, the data move, Claude prompts) runs on our machines. Browsers and phones get only the compiled, minified app screens, with no source maps in production builds. Someone with a trial can see what the screens do, but not how the server does it.
- **The repository is private, and access is limited.** This session can only reach `r00maker/fitness-platform`.
- **No secrets are committed.** `.env` files are ignored, keys live in the hosting provider's settings, and the Supabase service-role key is never used.

Worth doing:
- Turn on two-factor sign-in for everyone on GitHub, and branch protection on `main` (reviews required, no force-pushes).
- Turn on GitHub's secret scanning and Dependabot alerts.
- Get an IP assignment agreement and an NDA from anyone you hire or contract, before they see the code.
- Use terms of service for studios that forbid copying, reverse engineering and competitive use (the trial terms already say this). Register the trademark for the product name.
- Keep the preview artifacts private. They contain much of the product's behaviour in one file.
- Limit HQ to named staff, and review the audit log now and then.

Code can always be rewritten by someone determined. The defensible part is the business: the studios using it, their data, the team that moves it, and how fast the product improves.
