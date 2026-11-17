# Clickable preview

`studio-calendar-preview.html` is a single-file, clickable preview of the app with sample data (admin, Front of House, instructor and client views; light and dark). It mirrors the rules in `apps/api` so features can be tried before the web and mobile apps are built. Open it in a browser; nothing is sent anywhere. (Opening a PDF attachment loads the pdf.js reader from cdnjs.)

`phone-preview.html` is built by `python3 build-phone.py` (after `inject.py`): the studio preview running in phone-sized frames (client booking, instructor's My day, check-in mode), published as its own artifact. It's git-ignored; rebuild it rather than editing it.

`hq-preview.html` is a separate clickable preview of HQ, our own team's dashboard (overview, studios, a studio's page with plan, support access, team invites and notes, adding a studio, the moving form as the studio sees it, the data-move workspace and the assistant with sample answers). The move workspace runs the same rules as the API's migration engine in the browser: upload a real CSV (or use the sample exports) to see it read, mapped and checked row by row. It's one hand-written file with no build step; it's published as its own artifact (the publish adds the page skeleton, so the file starts at `<title>`).

## How it's built

The HTML file is both the base and the output. `inject.py` puts the feature code from `src/` into it between markers, then applies small, repeatable edits to the base code (`patch9.py` to `patch18.py`):

- `src/mkt.css`: styles for everything added in `src/` (light and dark).
- `src/*.js`: concatenated in the order listed in `inject.py`, into one shared scope. Later files can wrap earlier pages (`PAGES.x` / `BIND.x`) or override function declarations.
  - `mkt.js` marketing (journeys, emails, campaigns, segments, banners, gift cards), `mkt3`–`mkt7` locations, loyalty, appointments, reports and more, `mkt8.js` Communication (WhatsApp and email), `mkt9.js` menu groups, agents and the assistant, `mkt2.js` announcements.
  - `mkt10.js` calendar double-click and drag, rooms optional, class types split, Categories window.
  - `mkt11.js` Sales (invoices, receipts, refunds, invoice design) and membership payment holds.
  - `mkt12.js` Shop, Pickups, writing agents, report exports, menu entries.
  - `mkt13.js` Closures and holidays (with `patch11.py`, which shades closed days on the calendar and teaches the class form about them).
  - `mkt27.js` Booking on the web: Setup, Booking page (the link, on/off, the line at the top, the button colour, the code for the studio's website with its options, and a live preview of the widget), and the public booking page as visitors see it (**Open booking page**, or `#book`): the timetable by day with filters, a class with the packages that cover it, the packages tab, and sign-in (a stand-in) that hands over to the client app (the class opens with the usual booking rules, or the package goes to checkout).
  - `mkt26.js` Online payments: Setup, Payments (connect Stripe, where it is with Stripe, how clients pay, passing the fee on for cards and GrabPay, recent online payments), choosing how to pay at checkout (a stand-in for Stripe's page; paying completes the order like a desk payment), paying a waiting order later, memberships paid by card only (no paying at the studio), and the client's **Payment method** page (the card kept for renewals, which memberships use it, replace; it can't be removed while a membership renews on it). `#payments-ready` opens with Stripe already connected.
  - `mkt25.js` One place for each job: Tell clients (replaces Announcements in the menu), Automations (client journeys and team reminders; replaces Agents in the menu), and Write with AI buttons next to text boxes.
  - `mkt24.js` The welcome page: the owner's first sign-in until the studio opens (the stage with the week filling up, the form with its rail, Send to our team, Send updates, the move's progress, the studio opening), and Setup, Studio details. The **Studio** control in the header (Open / Setting up) is for the preview only; `#welcome` opens straight on it, and **Back to the studio view** at the top of the welcome page returns to the dashboard (answers are kept).
  - `mkt23.js` Phones: clients' date strip, day list, one-line notices and one Filter button on Book a class; instructors' Up next with Check in on My day, and check-in mode.
  - `mkt22.js` Reports by location: the Locations tab on Reports (Signature), locked with "In Signature" on other plans.
  - `mkt21.js` Plans: the plan card on Setup, Features, features locked with the plan that includes them, banners and AI workflows by plan, the getting-started list on Home, and Studio rules search with "Changed from the usual" marks (with `patch18.py`, which tags each Studio rules row with its setting). The **Plan** control in the header is for the preview only; in the real app only our staff change plans.
  - `mkt20.js` Feature switches (Setup, Features) and the grouped menu: related pages share one menu item with tabs, and switched-off features disappear from menus, tabs, Home and the client app (with `patch17.py`, which adds the tabs to pages and hides switched-off pages).
  - `mkt19.js` Full class names on the calendar: names wrap instead of being cut short, and blocks make room for them (with `patch16.py`, which also gives the sample class types versioned names like "Reformer - Intermediate").
  - `mkt18.js` Reviews (the client pop-up and the Reviews page), client feedback and the staff Feedback page, and celebration pop-ups (with `patch15.py`).
  - `mkt17.js` Deleting templates and the attendance lock (with `patch14.py`).
  - `mkt16.js` Quick view for attachments (PDFs drawn with pdf.js, loaded from cdnjs only when a PDF is opened) and the waitlist setting (with `patch13.py`).
  - `mkt15.js` Home, the staff front page (today, needs attention, how it's going, the week ahead).
  - `mkt14.js` Cancelled classes on the calendar ("Show cancelled") and each class's Cancellations tab (with `patch12.py`).

Rebuild after editing anything in `src/` or the patches (run it from this folder; it's safe to run repeatedly):

```bash
python3 inject.py
```

`patch*.py` use `swap(old, new)` (replace once; skipped if `new` is already there) and `once(marker, anchor, text)` (insert before `anchor` unless `marker` exists). If a later patch needs to change text an earlier patch inserted, change the earlier patch instead, or the earlier one's `old` text won't be found.

## Checks

Playwright scripts in `checks/` (Chromium; run from `checks/`). Each prints PASS/FAIL lines and a total, and saves screenshots to a folder next to it (git-ignored).

```bash
node s10check.cjs
```

- `s10check.cjs` sales, holds, shop, calendar, rooms, goals, class types, categories, writers, email, exports.
- `hqcheck.cjs` the HQ preview: overview, search and filter, plan changes (asks before moving down), support access and notes, the assistant, the moving form, reading an uploaded CSV, the data move (blocked on ambiguous dates, columns, accept warnings, sample, verify, undo), starting a move, inviting the owner, roles, and adding a studio.
- `tccheck.cjs` Tell clients (what's missing, reach per place, news vs offers, Front of House, history), Write with AI (drafting, In Signature on Growth) and Automations (one list, filters, opening each editor).
- `wccheck.cjs` the welcome page: what's needed before sending (UEN format too), answers kept, Send to our team, changes named, Send updates, the move finishing, the dashboard opening with the business details in Setup.
- `pncheck.cjs` phones: the client date strip and day list, notices on one line, the Filter button, opening a class; Up next and check-in mode (search, waiver prompt, undo, big rows). Desktop keeps the calendar.
- `lrcheck.cjs` reports by location: both locations side by side against the period before, the period switch, and the locked tab on Growth.
- `plcheck.cjs` plans: the plan card and price, moving down (asks first, says what switches off and what's over the limits), moving up, locked features, banners and AI workflows by plan, Studio rules search and "Changed" marks, and the getting-started list.
- `ftcheck.cjs` feature switches and the grouped menu: old page addresses, tabs, the menu remembering the last tab, asking before switching off, what hides and what carries on, and switching back on.
- `nmcheck.cjs` full class names in the week, day, month and phone list views (computer, laptop, iPhone 13 and iPhone SE; admin, instructor and client), including a much longer name.
- `rvcheck.cjs` reviews, the Google offer, feedback for clients and staff, and celebrations for owners and instructors.
- `fxcheck.cjs` the Studio rules save button clearing the Ask button, deleting templates, and the attendance lock with when fees become final.
- `qvcheck.cjs` the attachment quick view and the waitlist setting. pdf.js is served from a local copy so it runs without internet: `npm pack pdfjs-dist@3.11.174`, unpack it, then `PDFJS_DIR=<unpacked>/package/build node qvcheck.cjs`.
- `hmcheck.cjs` Home for every role: the numbers, filters, the week-ahead chart and table, and where each button goes.
- `cxcheck.cjs` cancelled classes on the calendar and the Cancellations tab, for every role.
- `clcheck.cjs` closures and holidays: the page, adding one, the calendar for staff and clients, repeats, the closed-day warning, editing and removing.
- `agcheck` agents and assistant, `cmcheck` communication, `apcheck` appointments and class types, `adcheck` ads and leads, `upcheck` earlier upgrades.
- `uiaudit.cjs <width>` walks every page in every role, light and dark, and reports contrast, overflow and sideways scrolling (`node uiaudit.cjs 1360`, `node uiaudit.cjs 390`).
- `selaudit.cjs` checks every dropdown renders correctly in both themes.

## Publishing

The preview is published as a private claude.ai artifact (it declares the `downloads` capability so CSV and report exports can be saved from the viewer). Republish the same artifact URL after rebuilding, rather than creating a new one.

The celebration and review pop-ups open by themselves (on Home, and on Book a class for clients). Checks that aren't about them set `window.__quiet = true` with `addInitScript` before the page loads, so a pop-up doesn't cover what they test. New checks should do the same unless they test the pop-ups.
