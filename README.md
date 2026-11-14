# Studio Platform: backend

The booking and scheduling backend for class-based studios. One API serves the web app and the mobile app, so every workflow behaves the same on both.

## What's in here

```
apps/api/            The API server and background worker (TypeScript, Fastify, PostgreSQL)
  src/modules/
    sessions/        Calendar, classes, recurring series, bulk edit, duplicate, cancel/delete
    closures/        Closures and holidays: recurring classes skip them, one action cancels the days
    bookings/        Book, cancel, move (reschedule), refund, attendance
    waitlist/        Join/leave/claim, auto vs "ask me first", hold timers, cut-offs
    substitutes/     Cover requests, accept/decline, automatic or admin-approved
    checks/          "Please check" warnings that catch likely mistakes (see below)
    catalog/         Locations, rooms, class types (colours), templates
    notifications/   Email + push outbox, wording, providers (Postmark, Expo push)
    settings/        Studio policies, the signed-in user, push-token registration
  drizzle/           Database migrations (SQL, committed and reviewed like code)
  test/              Automated tests against a real PostgreSQL database
packages/shared/     Used by the API, web app and mobile app:
  fields.ts            plain-English labels + hover help for every field
  schemas.ts           request validation (same rules on the forms and the server)
  enums.ts             every option list (roles, statuses, modes…)
docs/                Hosting, deployment and product-gap notes
```

## Run it locally

You need Node 22+, pnpm and PostgreSQL 16 (`docker compose up -d` starts one).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # then set AUTH_DEV_SECRET (openssl rand -hex 32)
pnpm db:migrate
pnpm db:seed                                 # demo studio; prints an owner sign-in token
pnpm dev                                     # API on http://localhost:3000
pnpm worker                                  # in a second terminal: sends notifications, runs timers
pnpm test                                    # needs a studio_test database
```

Example: `curl "localhost:3000/v1/calendar?view=week&date=2026-11-11" -H "Authorization: Bearer <token>"`

## Access levels

| Role | Sees | Can change |
|---|---|---|
| **Admin** (and Owner) | Everything, including client contact details, history, fees and (later) payments | Everything |
| **Front of House** | The whole schedule and every class's client list, including contact details | Attendance and client tags |
| **Instructor** | Only their own classes, including contact details for those clients (plus a class they've been asked to cover, without its client list) | Attendance on their own classes; asking for and accepting cover |
| **Client** | The public schedule and their own bookings | Their own bookings, within the studio's rules |

Defined once in `PERMISSIONS` (`packages/shared/src/enums.ts`).

## Class lists, spots and privacy

- **Class lists** show each client's photo, spot, tags, classes attended and a first-visit marker. The package used is added once the payments module exists.
- **Spot selection:** rooms can have named spots (`spotLabels`, e.g. "Reformer 1"). Clients pick one when booking. Admin bookings, waitlist auto-enrolment and moves get the next free spot. Two people can't hold the same spot.
- **Who's attending:** studio members (not ClassPass) can see other members on the spot picker as "Sarah L.". Any client can hide themselves with `PATCH /me/privacy`.
- **No accidental late bookings:** a client booking inside the late-cancellation window is asked to confirm first, because they won't be able to cancel for free.

## Instructors and cover

- **Photos:** instructors and clients both have a `photoUrl`. The calendar and class detail include the instructor's photo.
- **Favourite instructor:** the instructor a client has attended most (at least 3 classes, no tie). Clients get `favouriteInstructor: true` on those classes in the calendar. Instructors see `favouriteInstructor` and `classesWithInstructor` for each client on their class list.
- **Cover:** when an admin swaps in another instructor with `asCover: true` (one class at a time), or a cover request is filled, the class records who usually teaches it (`cover.forInstructor`). Switching back to the usual instructor clears it. A permanent change isn't shown as cover.
- **Teaching lists:** `PUT /class-types/:id/instructors` sets who teaches and covers each class type. Cover requests go to that list by default (everyone, if there's no list). `GET /sessions/:id/cover-options` gives the "Ask for cover" screen each instructor's status (on the list, busy at that time) and a suggested selection. Assigning someone not on the list is flagged for confirmation.
- **Suggested fixes** for odd times only offer a believable class (15 minutes to 3 hours, starting 5am–10pm). They try the AM/PM correction first, then the class type's usual length, and otherwise offer nothing.

## Booking rules (per studio, in `/settings`)

| Rule | Default | Clients | Admins |
|---|---|---|---|
| Booking opens | 14 calendar days before (local midnight) | Can't book or waitlist earlier | Can, with a note |
| Booking closes | 1 hour before class | Can't book or waitlist later; waitlists stop here | Can add people until the class ends |
| Late-cancellation window | 12 hours | Cancelling inside it loses the credit (warned first); **can't move** inside it | Can cancel or move, choosing the refund |
| Weekly class limit | Off (unlimited) | Stopped at the limit | Can go over after confirming |
| Late-cancellation fee | Off | Warned with the amount before cancelling | — |
| No-show fee | Off | Added when marked no-show, removed if corrected | Can waive with a reason |

Fees are recorded as "to be collected" until the payments module is built.

## API overview (`/v1`)

| Area | Endpoint | Who |
|---|---|---|
| Calendar | `GET /calendar?view=day\|week\|month&date=&locationId=&classTypeId=&instructorId=&timeOfDay=&q=` | everyone (instructors: own classes only; clients: no staff notes) |
| Class detail + roster + waitlist | `GET /sessions/:id` | see Access levels |
| Create class (from template or from scratch) | `POST /sessions` | owner, admin |
| Recurring classes | `POST /series` | owner, admin |
| Edit (this / this and later / whole series) | `PATCH /sessions/:id` | owner, admin |
| Bulk edit / bulk cancel | `POST /sessions/bulk-update`, `POST /sessions/bulk-cancel` | owner, admin |
| Cancel / delete | `POST /sessions/:id/cancel`, `DELETE /sessions/:id` | owner, admin |
| Duplicate a class / copy a week | `POST /sessions/:id/duplicate`, `POST /sessions/duplicate-range` | owner, admin |
| Closures and holidays (cancels classes on those days after confirming) | `GET /closures`, `POST /closures/preview`, `POST /closures`, `PATCH\|DELETE /closures/:id` | read: all · write: owner, admin |
| Templates, class types, locations, rooms | `/templates`, `/class-types`, `/locations`, `/rooms` | read: all · write: owner, admin |
| Book | `POST /bookings` | client (self), admin (any client) |
| Cancel / move / refund a booking | `POST /bookings/:id/cancel\|move\|refund` | client (own, within rules), admin |
| Attendance (one / whole class) | `PUT /bookings/:id/attendance`, `POST /sessions/:id/attendance/mark-all` | admin, Front of House, the class's instructor |
| Waitlist | `POST /waitlist`, `POST /waitlist/:id/claim\|decline`, `DELETE /waitlist/:id` | client (self), admin |
| Clients and fees | `GET /clients`, `GET /clients/:id`, `GET /fees`, `POST /fees/:id/waive` | admin |
| Client tags | `GET/POST /client-tags`, `PATCH/DELETE /client-tags/:id`, `PUT /clients/:id/tags` | read: staff · change: admin, Front of House |
| Who's attending / spots | `GET /sessions/:id/attendees` | studio members see first name + initial; ClassPass clients and hidden members aren't named |
| Privacy | `PATCH /me/privacy` (`showInAttendeeList`) | the client |
| Cover requests | `/substitute-requests` (+ `/:id/accept\|decline\|approve\|assign\|cancel`) | instructors (own classes), admins (any) |
| Studio policies | `GET/PATCH /settings` | owner, admin |
| My stuff | `GET /me`, `/me/bookings`, `/me/waitlist`, `/me/teaching`, `POST /me/push-tokens` | signed-in user |
| Wording for the apps | `GET /meta/fields` | public |

Every action that can raise warnings accepts `acknowledge: ["code", …]` (see "Mistake checks" below) and returns `flags` on success.

Every error comes back as `{ "error": { "code": "class_full", "message": "This class is full. Join the waitlist…" } }`. The `message` is written to be shown to users as-is, and form errors include a per-field `fields` map.

## How the key workflows behave

- **Notifications.** Every cancellation, deletion, time change and instructor change queues an email and a push to the people affected (instructor, booked clients, waitlisted clients). Messages go into a database "outbox" inside the same transaction as the change, and the worker delivers them with retries. If a change fails, no message goes out; if the email provider is down, nothing is lost.
- **Waitlist.** When a spot opens, "Book me in automatically" clients are booked straight away. "Ask me first" clients get the spot held for 10 minutes (the studio can change this), and while it's held nobody else can take it. Each client picks a cut-off from the studio's three options (default 5h / 3h / 1h before class). Once it passes, they're removed and told.
- **Cover.** In *automatic* mode the first instructor to accept gets the class. In *manual* mode admins are notified and choose from the instructors who accepted. Admins can also assign cover directly.
- **Delete vs cancel.** Deleting a class nobody ever booked removes it. A class that had bookings is cancelled instead, which keeps refunds, history and reports correct.
- **Last spot.** Bookings lock the class row, so two people can't take the last spot at the same moment (this is tested).
- **Time zones and daylight saving.** Times are stored in UTC and shown in each location's local time. "Adjust for daylight saving" is a studio setting, **off by default** (suited to Southeast Asia), which uses the zone's standard offset all year. Switch it on for studios where the clocks change.

## Mistake checks ("please check" warnings)

Unusual things are **flagged, not blocked**, and the user decides. If a change raises a warning that needs confirming, nothing is saved and the API replies `409 needs_confirmation` with the list. Each item has a plain-English message and, where possible, a one-tap `suggestion`. Sending the same request again with `acknowledge: [codes]` completes it. Acknowledging one warning never waves through a different one. "Info" notes are shown but never stop anything. Staff also see clash badges on the calendar.

| Check | Level | Example message |
|---|---|---|
| Instructor double-booked | confirm | "Ana is also teaching Vinyasa Yoga at 9:00am on Fri 13 Nov." |
| Room already in use | confirm | "Studio 1 is also being used for Reformer at 9:00am…" |
| Looks like a duplicate | confirm | "There's already a Reformer Pilates class here at 9:00am…" |
| Ends after midnight | confirm | "This class runs from 11:00am to 12:00am (midnight) the next day (13 hours). Did you mean 11:00am to 12:00pm (noon)?" |
| Unusually long / short | confirm | "This class is 13 hours long… Did you mean…?" / "only 5 minutes long" |
| Unusual start time | confirm | "This class starts at 3:00am. Did you mean 3:00pm?" |
| Different length from usual | info | "Reformer Pilates is usually 50 minutes; this one is 90." |
| Date in the past / over a year away | confirm | "…over a year away. Is the year right?" |
| More spots than the room holds | confirm | "Studio 1 holds 30 people, but this class has 40 spots." |
| Booked clients affected | confirm | "12 booked clients will be told about the new time." |
| Waitlist affected | confirm/info | "3 people are on the waitlist and will be taken off it." |
| Short notice | confirm/info | "This class starts in 3 hours. Clients may already have planned around it." |
| No refund | confirm | "Booked clients won't get their class credit or payment back." |
| Class already happened | confirm | cancelling a past class |
| Lots of classes at once | confirm | "This will cancel 34 classes." |
| Client already booked at that time | confirm | "Chloe is already booked into Vinyasa Yoga at 9:00am…" |
| Already refunded | confirm | "This booking was already refunded on 2026-11-11 (class credit)." |
| Class hasn't started (mark all present) | confirm | |
| No instructor / client attended / walk-in after start | info | |

Thresholds (3 hours, 5am–10pm, 24h notice, 20 classes…) live in `FLAG_LIMITS` in `packages/shared/src/enums.ts`. Things that genuinely can't work are still refused, such as fewer spots than people already booked, or editing a cancelled class.
