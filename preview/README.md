# Clickable preview

`studio-calendar-preview.html` is a single-file, clickable preview of the app with sample data (admin, Front of House, instructor and client views; light and dark). It mirrors the rules in `apps/api` so features can be tried before the web and mobile apps are built. Open it in a browser; nothing is sent anywhere.

## How it's built

The HTML file is both the base and the output. `inject.py` puts the feature code from `src/` into it between markers, then applies small, repeatable edits to the base code (`patch9.py`, `patch10.py`, `patch11.py`):

- `src/mkt.css`: styles for everything added in `src/` (light and dark).
- `src/*.js`: concatenated in the order listed in `inject.py`, into one shared scope. Later files can wrap earlier pages (`PAGES.x` / `BIND.x`) or override function declarations.
  - `mkt.js` marketing (journeys, emails, campaigns, segments, banners, gift cards), `mkt3`–`mkt7` locations, loyalty, appointments, reports and more, `mkt8.js` Communication (WhatsApp and email), `mkt9.js` menu groups, agents and the assistant, `mkt2.js` announcements.
  - `mkt10.js` calendar double-click and drag, rooms optional, class types split, Categories window.
  - `mkt11.js` Sales (invoices, receipts, refunds, invoice design) and membership payment holds.
  - `mkt12.js` Shop, Pickups, writing agents, report exports, menu entries.
  - `mkt13.js` Closures and holidays (with `patch11.py`, which shades closed days on the calendar and teaches the class form about them).

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
- `clcheck.cjs` closures and holidays: the page, adding one, the calendar for staff and clients, repeats, the closed-day warning, editing and removing.
- `agcheck` agents and assistant, `cmcheck` communication, `apcheck` appointments and class types, `adcheck` ads and leads, `upcheck` earlier upgrades.
- `uiaudit.cjs <width>` walks every page in every role, light and dark, and reports contrast, overflow and sideways scrolling (`node uiaudit.cjs 1360`, `node uiaudit.cjs 390`).
- `selaudit.cjs` checks every dropdown renders correctly in both themes.

## Publishing

The preview is published as a private claude.ai artifact (it declares the `downloads` capability so CSV and report exports can be saved from the viewer). Republish the same artifact URL after rebuilding, rather than creating a new one.
