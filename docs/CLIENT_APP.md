# The client app (branded, per studio)

`apps/client`: the app a studio's members use day to day, in the studio's own look. It's separate from `apps/web` (the public booking page, buying and joining, `docs/WEB_APP.md`). Studios with the branded app (Signature, or Growth with the SGD 99 add-on) set its look; everyone else gets the plain "Studio" look in their booking-page colour.

Built with Vite, React 18 and TypeScript. It talks to a `Backend` (`src/data/types.ts`): the real API (`http.ts`), or three demo studios that run in the browser (`demo.ts`) for the showcase and for trying it without a server.

## What members see

- **Home is never blank.** It has:
  - a greeting and the studio's welcome line;
  - the studio's banners, which rotate at the studio's setting and pause while someone is reading;
  - their next class;
  - a tally of classes to the next milestone;
  - this month against their own goal;
  - achievements;
  - three classes to book straight from Home (the kinds they book most).
- **Milestones** are the studio's to choose: 10, 20, 50 and 100 by default. Aizome counts to 108, a number that means something in yoga. The tally draws a mark per class since the last milestone, in fives like a rep count, and the class they're on next breathes in the highlight colour.
- **Monthly goal:** they set it with one tap (4, 8, 12 or 16 a month) and change it with − and +. There's a dot per class in the goal: filled when done, ringed when booked. The goal carries on into later months until they change it.
- **Achievements:**
  - First class;
  - each milestone;
  - Goal met;
  - Four weeks running;
  - Early riser (5 classes before 8am);
  - Explorer (3 kinds of class).

  Ones not yet earned show progress ("10 of 20").
- **Celebrations:** when the app opens, it shows the one most important thing that happened in the last 3 weeks and hasn't been shown yet. That's a milestone, then a goal met, then an achievement. It's the app's single animated moment, and the studio's mark draws itself: a leaf unfurls (Linden), a wave rolls (Tidal), a red seal is stamped (Aizome) or a spark opens (Studio). Each celebration shows once. Esc or Close dismisses it, and its button goes to booking.
- **Booking with one check:**
  - Filters are one row of taps: kinds of class, time of day, teacher and location. They apply at once and are remembered.
  - The two-week day strip shows how many classes match on each day, so nobody taps through empty days.
  - **Book** opens a short confirmation inside the row, saying:
    - what it uses ("Uses 1 class from your 10-class pack. 5 left after this.");
    - or, for memberships booked into next month: "Booked ahead into your membership for the month starting 1 Dec…";
    - and whether cancelling later is free ("Free to cancel until 11:00pm today"), or a warning if it isn't.
  - **Confirm booking** books it, and a toast offers **Undo**.
  - That's two taps from the timetable, with one check against mis-taps.
  - If the studio's rules want another check (for example a weekly limit), it appears in the same place with **Book anyway**.
- **My classes:** upcoming classes, each cancelled in place. Inside the late window, the API's warning shows first, with **Cancel anyway**.
- **Me:**
  - packages, with how their dates work: "Started on 6 Nov, the day of your first class. Booking an earlier class moves the start back…";
  - for memberships, what's booked ahead;
  - the goal and every achievement;
  - the studio's locations and cancellation rule.

## What a studio can change (the look)

This is `GET/PATCH /v1/app-theme` (owners and admins, with the branded app). The look is public with the studio at `/v1/public/studios/:slug` (`theme`), so the app is dressed before anyone signs in. Studios start from a preset and change any part of it:

| Part | Choices |
|---|---|
| Colours | Background, cards, text, quieter text, lines, the brand colour and the text on it, a highlight |
| Typefaces | A display face and a body face from a short list that reads well on phones (`APP_FONTS`): Young Serif, Shippori Mincho, Bricolage Grotesque, Figtree, Zen Kaku Gothic New, Manrope |
| Corners | Square, soft or round (pill buttons) |
| Celebrations | Leaf, wave, seal or spark: also the shape of achievement badges and the milestone marker |
| Welcome line | Under the greeting on Home, e.g. "Slow is still forward." |
| Milestones | Up to 12 class counts |
| Logo and banners | From the booking page and Marketing, Banners (as before) |

Presets (`packages/shared/src/app-theme.ts`). Each of the three examples was designed for its kind of studio:

- **Studio:** neutral, in the booking-page colour. It's the default, and what studios without the branded app get.
- **Linden** (reformer pilates): sage and deep linden green, Young Serif with Figtree, soft corners, a leaf.
- **Tidal** (barre): cobalt and candy pink, Bricolage Grotesque set heavy and narrow, pill shapes, a wave.
- **Aizome** (yoga): stone and indigo, Shippori Mincho with Zen Kaku Gothic, square corners, a red seal for each achievement, and 108 as a milestone.

## The API it uses

- `GET /v1/public/studios/:slug` (with `theme`) and `/schedule`.
- `GET /v1/me/progress`: classes done, the next milestone, the month against the goal, weeks in a row, achievements, the celebration to show and a nudge. A class counts once it's finished and wasn't a no-show, so studios that don't take attendance still see progress.
- `PUT /v1/me/goal` `{ classes }` (1 to 60, or null to clear).
- `POST /v1/me/celebrations/:key/seen`.
- `GET /v1/sessions/:id/package-options`, which now includes `freeCancelUntil`, `insideLateWindow` and, per package, `bookedAhead`.
- `POST /v1/bookings`, `POST /v1/bookings/:id/cancel`, `POST /v1/waitlist`, `GET /v1/me/bookings`, `GET /v1/me/packages` and `GET /v1/me/banners`.

The API's CORS now allows PUT, PATCH and DELETE from the apps' addresses. Before this, the default allowed only GET, HEAD and POST, so a browser app couldn't change a goal or a setting. The live check caught it.

## Running it

```bash
pnpm --filter @studio/client dev
```

Locally, sign-in is the dev email code (000000); with Supabase it's the same as `apps/web`. The studio comes from `/s/<slug>`, from `?studio=<slug>`, or from `VITE_STUDIO` for a studio's own build. Members join on the booking page first.

To try it without a server, add `?demo&studio=linden` (or `tidal`, `aizome`). The showcase (`showcase.html`) puts all three side by side.

## Checks

- `node e2e/check.mjs` (44 checks) builds the demo and runs it in Chromium, covering:
  - Home;
  - the tally and goal;
  - the booking confirmation, Not now, Confirm, Undo;
  - filters (instant, counted per day, remembered);
  - cancelling;
  - packages;
  - the two celebrations (focus, Esc, shown once);
  - each look's typeface, corners and motif;
  - no sideways scrolling at phone width;
  - the wide layout;
  - reduced motion;
  - the showcase.
- `node e2e/live.mjs` (13 checks) runs the app on the real API, against the seeded throwaway database `studio_e2e`:
  - the studio sets its look;
  - a member signs in and sees it;
  - progress comes from the API;
  - they set a goal;
  - they book with the confirmation and cancel through the late-window check.
- API tests: `apps/api/test/client-app.test.ts` (progress, milestones, goals, achievements, celebrations, the look and plan gating, CORS) and `book-ahead.test.ts`.

## Not built yet

- Buying packages inside the app. For now it's on the booking page (`apps/web`), and the confirmation links there when nothing covers a class.
- The waiver at first booking. Studios that need one have members sign it on the booking page first.
- Push notifications, and the app-store wrappers (Expo) for each studio's branded app.
- The studio's screen for choosing the look (the API is ready, and the showcase shows the three examples).
- Sharing an achievement.
