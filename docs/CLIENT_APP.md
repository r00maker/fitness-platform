# The client app (branded, per studio)

`apps/client`: the app a studio's members use day to day, in the studio's own look. It's separate from `apps/web` (the public booking page, buying and joining, `docs/WEB_APP.md`). Studios with the branded app (Signature, or Growth with the SGD 99 add-on) set its look; everyone else gets the plain "Studio" look in their booking-page colour.

Built with Vite, React 18 and TypeScript. It talks to a `Backend` (`src/data/types.ts`): the real API (`http.ts`), or three demo studios that run in the browser (`demo.ts`) for the showcase and for trying it without a server.

## What members see

Four tabs: Home, Book, My classes and Me. The selected tab is marked with a short bar in the brand colour. Every screen opened from somewhere has **Back**, which returns to where it was opened from. For example, a class opened from Home goes back to Home, not My classes.

- **Home is never blank.** It shows:
  - the studio's banners;
  - their next class (tap for its screen);
  - a bar to the next milestone, with the studio's mark at the end;
  - this month against their goal;
  - one line for achievements;
  - three classes to book straight from Home.

  Home shows the goal but doesn't change it. With no goal set, it offers **Set a monthly goal**.
- **A class's screen:**
  - when, where, the instructor (starred if they're the member's favourite), the length and what the class is like;
  - **Book**, or **Cancel booking** with the studio's late-cancellation check.
- **The timetable shows a week at a time**, with arrows for next week, so nothing is cut off at the screen's edge.
  - Filters wrap onto the next line instead of scrolling sideways. They apply at once and are remembered.
  - **Classes with Ana** is one tap. The studio works out each member's favourite instructor from the classes they've been to, and stars those classes in the list.
  - There are no counts under the dates.
  - **Book** opens one short check in the row: what it uses, and until when cancelling is free. **Confirm booking** books it, and the toast offers **Undo**.
  - On a member's first booking, the studio's waiver appears in the same place: tick, type their name, **Sign and book**.
- **Monthly goal (Me):**
  - With no goal: "Would you like to set a goal?", with 4, 8, 12 or 16 a month, or any number.
  - Raising it gets praise straight away.
  - Lowering it (or removing it) first shows how close they are to the goal they have ("You've done 5 and booked 2, with 9 days left. 1 more class gets you there"), with **Keep 9** as the main button. They can still change it.
- **Achievements:** one line on Home and in Me. The full screen has two parts:
  - the milestones in a short grid, with the next one marked and "3 to go";
  - five other achievements, with progress on the ones not earned yet.
- **Celebrations:** when the app opens, it shows the one most important thing from the last 3 weeks, once: a milestone, then a goal met, then an achievement. The studio's mark draws itself.
- **Me** is short groups of rows, each opening a screen:
  - **Your practice:** monthly goal, achievements.
  - **Packages:** each package, and **Buy a package**.
    - Buying: class packs and memberships, then a checkout with the bill, studio credit taken off, and how to pay (online, or at the studio).
    - A package's screen: classes left, dates and how they work (start dates follow the earliest class; booked-ahead classes on memberships), and the classes used. **Ask for more time** follows the studio's extension rules, including automatic approval. **Share it**, when the package allows. **Stop renewing**, or **Keep it renewing**, for memberships, with what happens to classes booked past the end.
  - **Shop and rewards** (when the studio has them):
    - Shop: products with sizes or colours, a basket, pay, collect at the desk.
    - Gift cards: a design, an amount, give it now or later.
    - My gift cards and credit: give a card, or keep it as credit.
    - Rewards: the balance, redeeming, codes for the desk.
    - Refer a friend.
  - **Health and safety:**
    - Injuries and health notes: add one, mark it better, or confirm it's still the case.
    - Waiver: read it, or sign it if not yet signed.
  - **Account:** purchases and receipts, the payment card, news and offers.

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

## The studio's screen for its look

**Setup, App look** in the studio app (the preview: `preview/src/mkt28.js`, checked by `alcheck.cjs`):
- the four looks to start from;
- the eight colours, with a warning (and a one-tap fix) when text on the brand colour would be hard to read;
- the typefaces, corners, celebration style, welcome line and milestones (up to 12, kept in order, no duplicates).

A phone beside it shows Home, the timetable or a celebration as the studio changes things. **Save look**, or **Undo changes**. Without the branded app it's locked, says how to get it, and shows the plain look members see meanwhile.

## The API it uses

- `GET /v1/public/studios/:slug` (with `theme`) and `/schedule`.
- `GET /v1/me/progress`: classes done, the next milestone, the month against the goal, weeks in a row, achievements, the celebration to show and a nudge. A class counts once it's finished and wasn't a no-show, so studios that don't take attendance still see progress.
- `PUT /v1/me/goal` `{ classes }` (1 to 60, or null to clear).
- `POST /v1/me/celebrations/:key/seen`.
- `GET /v1/sessions/:id/package-options`, which now includes `freeCancelUntil`, `insideLateWindow` and, per package, `bookedAhead`.
- `POST /v1/bookings` (with `waiver` on a first booking), `POST /v1/bookings/:id/cancel`, `POST /v1/waitlist`, `GET /v1/me/bookings`, `GET /v1/me/packages` and `GET /v1/me/banners`.
- `GET /v1/me` (the favourite instructor). The public timetable now includes each instructor's id, for the filter.
- Buying:
  - `GET /v1/public/studios/:slug/packages`;
  - `GET /v1/checkout/quote` and `POST /v1/checkout`;
  - `GET /v1/shop` and `POST /v1/shop/checkout`;
  - `GET /v1/gift-cards/shop` and `POST /v1/gift-cards/checkout`.
- Managing:
  - `GET /v1/client-packages/:id`;
  - `POST .../extension-requests`;
  - `POST`/`DELETE .../members`;
  - `GET .../stop-options`, `POST .../stop-renewing` and `.../resume-renewing`.
- Account:
  - `/v1/me/health-notes` (add, resolve, still current);
  - `/v1/me/waiver`;
  - `/v1/me/gift-cards` and `/v1/gift-cards/:id/give|keep`;
  - `/v1/me/loyalty` (and redeem);
  - `/v1/me/referral`;
  - `/v1/me/purchases`;
  - `/v1/me/payment-card`;
  - `/v1/me/marketing`.

The API's CORS now allows PUT, PATCH and DELETE from the apps' addresses. Before this, the default allowed only GET, HEAD and POST, so a browser app couldn't change a goal or a setting. The live check caught it.

## Running it

```bash
pnpm --filter @studio/client dev
```

Locally, sign-in is the dev email code (000000); with Supabase it's the same as `apps/web`. The studio comes from `/s/<slug>`, from `?studio=<slug>`, or from `VITE_STUDIO` for a studio's own build. Members join on the booking page first.

To try it without a server, add `?demo&studio=linden` (or `tidal`, `aizome`). The showcase (`showcase.html`) puts all three side by side.

## Checks

- `node e2e/check.mjs` runs 61 checks on the demo studios in Chromium. They cover:
  - Home: the bar, the read-only goal, one line of achievements and the tab marker;
  - Back returning to where a screen was opened from;
  - the timetable fitting on the screen (a 340px phone too), with a week at a time, the favourite-instructor filter and no counts;
  - booking and Undo;
  - a class's screen, and cancelling from it;
  - the goal: praise when raised, "Keep" when lowered;
  - achievements;
  - buying a package with credit;
  - asking for more time;
  - sharing;
  - the shop basket;
  - keeping a gift card as credit;
  - health notes;
  - redeeming a reward;
  - every Me screen;
  - stopping a membership;
  - the celebrations;
  - each look;
  - the wide layout;
  - reduced motion;
  - the showcase.
- `node e2e/live.mjs` runs 19 checks on the real API, against the seeded throwaway database `studio_e2e`:
  - the studio sets its look;
  - a member signs in and sets a goal in Me;
  - they book, signing the waiver in the row;
  - they cancel from the class's screen, through the late-cancellation check;
  - they buy a package (paid at the desk);
  - they add a health note;
  - the waiver shows as signed.
- API tests: `apps/api/test/client-app.test.ts` and `book-ahead.test.ts`.

## Not built yet

- Uploading a document with a request for more time (for studios that require one).
- Rolling classes over at checkout, choosing a start date, and using a discount code.
- Push notifications, and the app-store wrappers (Expo) for each studio's branded app.
- Saving the look from the studio's screen to the API. The screen is in the preview; the API (`PATCH /v1/app-theme`) is ready for the real studio app.
- Sharing an achievement.
