# The help centre

A knowledge centre for studio staff: how everything in Skedoo works, with troubleshooting for common problems. It sits alongside **Ask** (the assistant in the app):

- **Ask:** a quick answer about your own studio right now.
- **The help centre:** explains how everything works, for reading at your own pace.

## What's in it

**45 articles in 8 sections:**
- getting started;
- day to day;
- clients and packages;
- money;
- growth;
- AI;
- setup;
- troubleshooting.

Troubleshooting is written as the problems people hit, for example "I can't book a client into a class", "A no-show fee appeared or disappeared", "Online payments aren't working" and "A client didn't get an email or sign-in code".

**17 screenshots** sit beside the steps where seeing the screen helps:
- the menu;
- Home;
- the schedule and adding a class;
- a class with **+ Add client**;
- check-in;
- adding a closure;
- cover;
- packages;
- sales;
- payments;
- Tell clients;
- reports and Export;
- the booking page;
- App look;
- Studio rules search;
- features.

The part an article talks about is outlined. Each screenshot enlarges when tapped.

## Search

The search box finds articles as you type:
- **By their words,** in any form: "refunds" finds "refund".
- **By meaning:** "money back" finds refunds; "teacher sick" finds cover requests; "login" finds sign-in.
- **Despite small typos:** "refnud" finds refunds, and offers "Did you mean refund?".
- **From the start of a word:** "canc" finds cancelling.
- **Problems first:** searches like "can't", "not working" or "error" put troubleshooting at the top.

**When nothing matches well,** it says "No exact match", shows the 5 closest articles (by how much their wording overlaps), and suggests trying fewer words.

Matched words are highlighted in the results. Press `/` to search from anywhere; Back returns to your results.

## Private, not public

The help centre is only for signed-in studio staff, and is never indexed by search engines.

- **The studio app** has **Help centre** at the bottom of the menu (under Preferences) for owners, admins, Front of House and instructors; clients don't see it. It asks the API for a link (`GET /v1/help/link`) and opens it in a new tab.
- **The link** is signed (`HELP_LINK_SECRET`, which Render generates) and lasts 12 hours. Opening it keeps it in a cookie for `/help` only (HttpOnly, Secure, SameSite=Lax), and takes the key out of the address bar.
- **The API serves** the page at `https://api.skedoo.io/help/` and its screenshots at `/help/img/...`, only with that cookie. It sends a strict content security policy: only the page's own script runs. Without a valid link or cookie, `/help` shows "This page isn't available. Open it from Help centre in your studio app."
- **Every response** says `noindex, nofollow`, and the page's own `robots` tag says the same.

The studio preview links to a private claude.ai copy of the help centre instead, because the preview has no API behind it.

## Changing it

- **Articles** are in `docs/help/centre/*.md`, one file per section. Each article starts with a header block:

  ```
  ---
  id: closures
  title: Closures and holidays
  category: Day to day
  summary: One line, shown under the title and in search results.
  keywords: words people might search for, including other words for the same thing
  ---
  ```

  Then the article itself, with `##` headings, lists, tables, `**bold**`, links to other articles as `[text](#id)`, and screenshots as `![What it shows](img/name.webp "Optional second line")`. Keep the language plain, and keep it matching the screens.
- **Screenshots:** `NODE_PATH=<playwright> node apps/help/screens.mjs [name...]` retakes them from the studio preview (`preview/studio-calendar-preview.html`). The list of shots, with what each outlines, is at the top of that file.
- **Build:** `node apps/help/build.mjs` writes `apps/help/dist/`. It checks that every link goes to a real article and every screenshot exists. The API's Docker image builds it too.
- **Check:** `NODE_PATH=<playwright> node apps/help/check.mjs` runs 25 checks. They cover:
  - every article and screenshot;
  - the links between articles;
  - search by words, meaning and typos, the closest-match fallback, highlighting, Enter, Back and `/`;
  - the enlarged screenshots;
  - phone layout and dark mode.
- **API tests:** `apps/api/test/help.test.ts`. Staff get a link and clients don't; the link sets the cookie and leaves the address; and without a link, or with a forged one, the page and screenshots are "not found". It also checks that the screenshot route can't be used to read other files.
- **The studio preview's link:** `preview/src/mkt30.js`, checked by `preview/checks/hpcheck.cjs`.

`docs/help/STUDIO_GUIDE.md` is what Ask reads. When a screen changes, update both.
