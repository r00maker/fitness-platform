# Moving data and HQ

How we move a studio's data from its old system, and HQ, our own team's dashboard for onboarding studios, looking after them and fixing problems. Code: `apps/api/src/modules/migration/` and `apps/api/src/modules/platform/`. Previews: `preview/hq-preview.html` (HQ) and the welcome page in the studio preview (`#welcome`, or the header's Studio control).

## The promise

A studio fills in one form, gives us a way to get their data, and we move it within a day. The goal is accuracy first: nothing is guessed, every row is accounted for, and anything unclear comes back to a person.

## What old systems give us

Researched from each system's own help pages (November 2026):

| System | How data comes out | Watch out for |
|---|---|---|
| Mindbody | Reports exported as Excel or CSV: Mailing Lists (clients), Membership Detail, sales and series reports. A full export through Mindbody support can cost around USD 500. | Data is spread over several reports. Some "Excel" downloads are really web pages. |
| Momence | Customers list → Export, with memberships and credits left; subscriptions separately. | Counts packs with 0 credits as active. |
| Glofox | Reports → Memberships → Members → Download (needs the Admin role); client list export needs the Clients Export permission. | Permissions block exports for non-admins. |
| TeamUp | Customers → Export filtered list as CSV or Excel. | |
| PunchPass, Arketa, Vibefam, Rezerv, Walla, Mariana Tek, bsport | CSV or Excel from their customer and pass lists. | Formats vary; the mapping step handles it. |
| A spreadsheet | Whatever the studio kept. | Excel damages phone numbers (6.59123E+09, lost leading zeros). |

So the tool reads **CSV and TSV** (UTF-8 with or without a byte-order mark, UTF-16, Windows-1252; comma, semicolon, tab or pipe), **Excel .xlsx** (every sheet; real dates), and **"XLS" files that are web pages**. Old binary .xls files are refused with a clear fix (save as .xlsx or .csv) rather than guessed at. Card details never come in a file: memberships move, and clients add a card before their next billing date (or cards move Stripe to Stripe where the old system allows it).

## The welcome page (the owner's first sign-in)

When we add a studio in HQ, the owner is invited straight away. Their first sign-in opens the **welcome page** instead of the dashboard: a short introduction (a week of classes dropping into place: the studio moving in) and one form to get to know the studio (`GET/PUT /welcome`, owners and admins):

- **Your business:** studio name, registered business name, UEN (checked against ACRA's formats: 8 digits and a letter, 9 digits and a letter, or T/S/R…), GST registration number if registered, registered address, phone, website, Instagram.
- **Locations and rooms, what you teach, what you sell, your team.**
- **Moving your data:** nothing to move (a new studio), or the old system, switch date, rough counts (used to reconcile), how dates are written, how we get the data (add our team as a staff user, a temporary password kept encrypted and deleted after the move, or upload the exports at `POST /welcome/files`) and their OK.
- **Who we talk to.**

Answers save as you go. **Send to our team** (`POST /welcome/send`) checks the form is complete (saying what's missing in plain words), then fills the studio in from it: business details (shown on invoices and receipts, and editable later under Setup, Studio details), locations (the first one we made is renamed rather than duplicated), rooms, class types, packages (which the data move then matches clients' packs to by name) and the team (added without invites; they're invited when the studio opens). **Send updates** (`POST /welcome/update`) does the same again after a change and tells our team which sections changed; matching is by name, so nothing is duplicated or removed. The welcome page then shows the move's progress. Verifying the move in HQ opens the studio: the welcome page gives way to the dashboard (a studio with nothing to move is opened by our team in HQ). Our team can also fill the form in with them on a call (`PUT /platform/studios/:orgId/migrations/:jobId/intake`).

## Our side (HQ)

`/v1/platform/...`, roles **owner** (everything), **onboarding** (studios, plans, moves) and **support** (view, notes, support access, the assistant).

1. **Files.** Upload each export (`POST /platform/studios/:orgId/migrations/:jobId/files`, JSON with base64, up to 20 MB). Each sheet becomes a file. The header row is found under report titles, the kind is recognised (clients, class packs, memberships, upcoming bookings, visit history, not needed) and columns are matched by the many names systems use ("Member ID", "Barcode", "E-mail Address"). Our staff can change the kind, the header row or any column (`PATCH .../files/:fileId`); unmatched columns are listed, never silently dropped. The same file twice is refused.
2. **Check** (`POST .../check`). Runs the whole import inside a transaction and rolls it back, so the report is exactly what the import will do. It shows totals, every problem grouped (blocking, warning, info) with file and row, the counts against what the studio told us (within 3% or 2), and **every row accounted for**: each data row is created, linked, merged or not moved with a reason, and the four add up.
3. **Import** (`POST .../import`). Blocked while anything is blocking. Asks once (`migration_warnings`) to accept warnings and count differences. Runs the same code again and keeps it, recording what happened to every row (`migration_records`).
4. **Compare a sample** (`GET .../sample`). Ten random moved clients, their rows in the old files next to what they have here now. Our staff check them against the old system.
5. **Verify** (`POST .../verify`, with how many were checked). The old files' rows are deleted 30 days later by the worker.
6. **Undo** (`POST .../undo`). Removes everything the import added, as long as nothing has happened since (new bookings by moved clients, moved bookings cancelled or checked in, packs used, credit spent). Accounts that already existed are left alone. A verified move can't be undone.

## Accuracy rules

- **Dates:** ISO, day-first, month-first, "3 Apr 2026", "Apr 3, 2026", with or without a time. Day-first or month-first is worked out per column from values that can only be one way (a day above 12). If a whole column could be either, the form's answer decides; with no answer, the check stops and asks.
- **People** are matched by the old system's client ID, then email, then phone, then a name that's unique. A row we can't match is reported, never attached to someone who looks similar. Duplicates are merged (gaps filled, clashes reported).
- **Names** in one column are kept exactly as written, not split into first and last (many names don't split the Western way).
- **Email** is needed for an account. Clients without one are reported; if they hold a pack or membership that's a warning, so it gets fixed before import.
- **Existing accounts** (a client of another studio here) are linked; their own details aren't changed. Someone on the studio's team isn't added as a client.
- **Phones** go to international format using the studio's country. Numbers Excel damaged are reported, not "fixed".
- **Marketing consent** moves only where the file clearly says yes. Unclear wording is treated as no and reported.
- **Class packs:** classes left move exactly as exported; expired and used-up packs are left out (counted). Packs are matched to the studio's own packages by name; others move with their own name and terms. Expiry is the end of that day in the studio's time zone.
- **Memberships:** active ones only; they renew on the exported next billing date (or one period from today, reported).
- **Upcoming bookings** are matched to classes already on the schedule by date, time, class and location (so the schedule goes in first). They're attached to the client's moved pack without using another class (the old system already took it); a full class or a duplicate isn't booked.
- **Credit balances** become studio credit with a long expiry and the note "Credit moved from <system>". **Tags** are created or matched without regard to case. **Waivers** signed in the old system are recorded as confirmed by our staff member, with the date. **Visit history** is summarised per client (visits, first and last visit) with notes, emergency contact and date of birth kept as written (`client_history`).
- **Totals rows** at the bottom of reports are left out (reported as info).

## Privacy

- The studio agrees on the form before we move anything. Raw rows are kept only until 30 days after verifying (or undoing); a shared password is deleted at import or after 7 days, whichever is first.
- Every step is in the studio's own audit log, with our staff member as the actor.
- HQ shows studio overviews, health and setup from counts and settings only. A studio's client details are shown only during **support access**: time-limited (15 minutes to 4 hours), with a reason the studio sees, endable by the studio, every look logged in their audit log.

## The HQ assistant

`POST /v1/platform/assistant/ask` (chats are per staff member, `GET /platform/assistant/chats[/:id]`).

- **Model:** the most capable model at high effort (`HQ_ASSISTANT_MODEL`, default `claude-fable-5-2`; `HQ_ASSISTANT_EFFORT`, default `high`). Accuracy matters more than speed or cost for a few internal users. Thinking is always on for this model and is passed back unchanged each turn. Requests stream (long answers don't time out), tool inputs stream as they're written and are checked against their schema before running, and if the model declines, the API retries once on its default fallback model. This model keeps request data for 30 days, so it isn't zero-retention.
- **Knowledge:** every doc in `docs/`, the studio help guide and the README (with the API list), cached so each question costs a fraction.
- **Tools (read-only):** platform overview, search studios, a studio's overview (plan, features, health, setup, our notes), its activity log (details only with support access), failed or stuck messages with the last error, the data move's status and report, the schedule and studio rules; and, only during support access, find a client, why a booking would fail (the real booking rules, run and rolled back), and a client's bookings. Those look-ups are logged in the studio's audit log. There are no tools that change anything.
- It answers with what it looked at, ranks likely causes for technical issues, and can draft a plain reply for the studio.

## HQ: what else is there

- **Overview:** studios by status and plan, what live studios would pay a month at plan prices (billing isn't connected yet), studios that need attention (failed messages, failed agent runs or journey steps, memberships on hold, no bookings in 7 days, no staff activity in 14 days, setup stalled, over plan limits) and onboarding progress.
- **Studios:** search and filter; each studio's plan (change it, which asks first when something switches off), status (onboarding, live, paused, cancelled), health, setup checklist, team, recent activity, our notes, support access, and its data move.
- **Add a studio:** creates it with its first location and plan (features and the usual rules for its kind) and emails the owner an invite.
- **Our staff accounts:** `pnpm --filter @studio/api platform:staff <email> <owner|onboarding|support> [--first <name> --last <name>] [--remove]`.

## Not built yet

- Billing (plan prices are shown, not charged) and an MRR history.
- Moving card details Stripe to Stripe (done with Stripe's own data-migration process when the old system allows it).
- Recreating past visits as individual bookings (they're summarised).
- Pulling data straight from old systems' APIs (exports are the reliable common ground today).
