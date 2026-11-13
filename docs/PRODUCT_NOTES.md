# Product notes: decisions, assumptions and suggested additions

## Assumptions to confirm

| # | Topic | What I built | Alternative |
|---|---|---|---|
| 1 | Waitlist expiry (5h/3h/1h) | "Take me off the waitlist if I haven't got a spot X hours before class", so nobody is booked at the last minute. Each studio sets its own three options. | Expiry measured from when they *joined*. |
| 2 | 10-minute hold | Configurable per studio (default 10). The hold never runs past the class start time. | Shorter holds automatically when class is close. |
| 3 | Delete | Only removes classes that never had bookings or waitlists. Otherwise the class is cancelled, keeping history and refunds intact. | Always soft-delete. |
| 4 | Client late cancel | Inside the late-cancel window (default 12h) clients get no credit back; staff can override with a refund. | Fee charged instead. |
| 5 | Clients moving their own booking | Allowed outside the late-cancellation window, if the new class has space and is open for booking. Admins can move any time. | **Decided** |
| 6 | Access levels | Admin: everything. Front of House: full schedule, attendance only. Instructor: own classes, attendance only (plus cover requests). | **Decided** |
| 9 | Booking window | Opens 14 calendar days before at local midnight, closes 1 hour before. Waitlists stop when booking closes. | **Decided** |
| 7 | Bulk edit | Can change instructor, room, time, length, capacity, waitlist settings and notes across selected classes, but not dates (use duplicate for that). | |
| 8 | Template start/end | Templates store start time + length, and the end time is worked out, so the two can never disagree. | |

## Things I've added that weren't in the list

- **Mistake checks:** double-bookings, AM/PM slips, odd times, duplicates and more are flagged for the user to confirm, never silently blocked (see README).
- **Time zones per location**, with daylight saving as a studio setting (off by default).
- **"This class / this and later / whole series"** editing and cancelling for recurring classes.
- **Copy a week (or any date range)** to another week. Clashing classes are skipped and listed.
- **Admins can assign cover directly** without waiting for acceptances.
- **Instructor change notifications to clients** (studio can switch this off).
- **Audit log** of who changed what.
- **Room limits:** a class with more spots than its room holds is flagged.
- **Reliable notifications** (transactional outbox with retries).

## Waivers, health notes and cover: how they work

- **Waivers** are on by default and can be switched off under Studio rules. Studio members sign in the app (tick and typed name) at their first booking or when joining a waitlist, and never again. No one can book or waitlist a studio member who hasn't signed, staff included: staff are asked to get them to sign in the app, or to mark a paper copy done first. So members never appear on a class list without one. ClassPass clients are checked at the studio: Front of House, admins or the class's instructor mark them done after a "have you checked?" confirmation. Anyone shown without a waiver gets that button (for example, after an admin undoes one). Only admins can undo a completed waiver, and the record is kept. When studios change their wording, existing signatures stay valid and each signature records the version signed.
- **Health notes** (injuries, pregnancy, postnatal, recent surgery, medical conditions) are written by the client in plain English, either when booking or under "Injuries & conditions". The type is suggested from the wording on the device, so health details aren't sent to an outside service to be classified. The client can change the suggested type. Notes stay until resolved. When booking, a client is only asked "Still the same?" once a note is over 30 days old. Instructors see active notes for their own classes, and resolved notes drop off straight away. Clients can delete notes. Notes are never put in emails or push messages, and the audit log records that a note changed, never what it says.
- **Class lists show what matters first:** no waiver (in red), health notes, first class and up to two pinned tags ("+N" for the rest). Everything else is behind a tap.
- **Cover:** instructors can ask for cover but don't choose who covers. Their request goes to the class's teaching list and admins are told. Admins choose who to ask, approve offers or assign someone directly.
- **Favourite instructor filter:** clients tap one chip to see only that instructor's classes.

## Suggested next features (roughly in priority order)

1. **Online payments** (on hold): Stripe checkout so clients can buy packages and drop-ins themselves. Packages, prices, refunds and fees are all recorded today; no money moves until this exists.
2. ~~Booking rules~~: built (booking window, optional weekly limit, late-cancel and no-show fees).
3. **Closures & holidays**: block out dates so recurring classes skip them, with one action to cancel a whole day and notify everyone.
4. ~~Spot / equipment selection~~: built, and studios can switch it off.
5. ~~Instructor qualifications~~: built as teaching lists.
6. **Self check-in**: a QR code at the front desk or a tablet kiosk that marks attendance automatically.
7. **Notification preferences**: per-person email/push choices, quiet hours, and a single digest when an admin bulk-changes many classes.
8. **Calendar sync**: a private iCal feed so instructors and clients see their classes in Google/Apple Calendar.
9. ~~Instructor pay~~: built (see below). Could add later: pay for cancelled classes, mileage/travel between locations, shift-based hourly pay for front desk.
10. **Reports**: fill rate, waitlist-to-booking conversion, no-show rate and popular time slots.
11. ~~Waivers~~: built. **Intake forms** (longer health questionnaires) could build on health notes later.
12. **Virtual/hybrid classes** with a livestream link sent only to booked clients.
13. **Offline attendance** in the mobile app for studios with poor signal, syncing when back online.
14. **Translations**: wording already lives in one file (`packages/shared/src/fields.ts`), ready to translate.

## Packages, bookings for clients and payroll: how they work

- **Package types** are set up once: a class pack or an unlimited membership, its price, how long it lasts, when the countdown starts (when bought, or at the first booking), an optional deadline to book the first class, an optional weekly limit, which classes it covers, and whether (and how) it can be shared. The terms are shown everywhere as the same plain-English lines. Selling one copies the terms, so editing a package type never changes what someone already bought.
- **Using packages:** each booking uses the package that runs out soonest (clients can choose another). Cancelling in time gives the class back; late cancellations don't. Clients without a suitable package are told exactly why (e.g. "it expired on 3 Nov"). Staff can book them anyway as "Pay at studio" after a warning, or book them in for free (complimentary). Studios that let clients pay at the door can switch off "Clients need a package to book".
- **Sharing:** the buyer (or an admin) adds people by email, up to the package's limit. "One shared pool" means anyone can use any class; "Each gets their own share" means the buyer splits the classes and keeps whatever isn't given away. When someone stops sharing, their unused classes go back to the buyer.
- **Staff acting for clients:** booking someone in sends them a confirmation. Cancelling follows the studio's policy by default (inside the window: late, class not given back, fee if the studio charges one), and staff can override each part. Moving keeps the same package. Refunding after a class gives the class back to the package.
- **Payroll:** five pay types (per class, per client with optional base/minimum, tiered by class size, hourly, salary), set per person with optional different rates for particular class types. New rates start from a date, so past pay never changes. The report covers each pay period (weekly, fortnightly, twice monthly or monthly) with one-off adjustments, warnings (no rate set, attendance not taken), a CSV export, and "Mark as paid", which locks in the figures and shows any later differences. Instructors can see their own pay (studios can switch this off).

## Package lifecycle: extensions, rollovers, memberships, editing and tidying up

- **Extension requests** (studio setting): off, admins review each one, or approve automatically up to N days (once per package; longer or repeat requests are reviewed). Studios set the longest request, whether a document is optional or required, and a fee (free, flat, or per week added). Clients see the rules and fee before asking. Approved extensions run from the current end date, or from today if the package has already ended, and fees are recorded until payments are on.
- **Rollovers** (studio setting): off, staff only, or clients too (when buying a new package at checkout). Studios set the most classes per rollover and how long after a package ends its classes can still move. Both packages' histories show the move.
- **Recurring packages (memberships)** renew every period with a fresh set of classes, carrying up to a set number over, with an optional minimum term. Stopping one keeps it working to the end of the period, or of the minimum term if that's later. Renewals create an amount due until payments are switched on.
- **Editing a package type** asks whether the change applies to new sales, existing packages or both, says exactly what will change for clients, warns if any package would end sooner or expire straight away, and tells affected clients.
- **Categories** group the buying page. Each has an optional description shown under its name. Admins manage a category's packages from the categories window: add a package (moving it from wherever it was), reorder, or take one out (it goes to "Other"). `PUT /package-categories/:id/packages` sets the list and order in one go; a package moved into a category by editing it goes to the end. **Archiving** hides a package type and stops sales, while clients keep using what they have. **Deleting** (admins only, after typing the name) wipes the type and every package sold from it, including their history; bookings stay for attendance and pay, without the package link. The audit log notes that a deletion happened, with no client details.
- **Old packages:** rather than push notifications, the Packages page flags types nobody is using that haven't sold in 6 months (or are off sale) with "No one's using this: archive?". Housekeeping isn't urgent, so it shouldn't interrupt anyone.
- **Checkout** quotes the package (rules, price, start date, classes they could roll over) and creates an order. Until a payment provider is connected, orders are paid at the desk and an admin marks them paid, which creates the package. The provider plugs in at one point in the checkout code.
- **Photos and attachments** are checked by their actual contents (JPEG/PNG/WebP, plus PDF for attachments) with size limits. Attachments are only visible to the uploader and admins.

## Marketing: how it works

- **Email builder: built in, not bought in.** Designs are blocks (heading, text, image, button, divider, space, package, social links, two columns) stored as data, never HTML. The API turns them into email-safe HTML (tables and inline styles) plus a plain-text version. This means no per-seat fees from an outside builder, a look that matches the app, and no way for a design to carry scripts. The stored format is plain JSON, so an outside builder could still be added later if studios want one. Text supports **bold**, *italic*, links and `{{first_name}}`-style details; unknown tags are caught when saving. Images are uploaded to the studio and served from a public address so inboxes can show them.
- **Consent first.** Clients choose marketing emails and pushes when they join (off by default), and can change it under Profile. Every marketing email has an unsubscribe link (with a confirm button so link scanners can't unsubscribe people) and one-click unsubscribe headers. Each saved email is marked *marketing* or *service* (about their account or bookings); only service emails go to people who haven't opted in, so admins should use that honestly.
- **Segments** are live "clients who…" filters (classes attended, nett spend, days since last class, packages, credit, tags, where they came from, waiver, referrals and more), combined with all/any. Nett spend = packages + gift cards bought + fees paid − money refunded; credit and gifts received don't count. The client list uses the same filters (`POST /clients/filter`).
- **Campaigns** send a saved email to everyone or a segment, now or at a set time. Sending always asks first ("Send to 240 people?") and reports how many were skipped for not opting in.
- **Journeys** are a trigger plus steps that read top to bottom: wait, send email, send push, add or remove a tag, give a reward, tell the team, and two yes/no splits ("Check" anything you can filter by; "Wait for" a purchase, booking or visit within a set time). It's a tree, not a free canvas, so journeys can't loop or tangle. Each person keeps the version they started; edits apply to new starters. Emails and pushes due overnight wait until 8am (quiet hours). Ready-made journeys (intro offer follow-up, win-back, 50th class, last class used) come with their emails.
- **Ads (next step).** New members' ad click ids and UTM tags are saved when they join, so "Came from: Meta ads / Google ads" already works in segments and journey checks. Connecting Meta Lead Ads and Google lead forms (as a trigger) and sending conversions back (Meta Conversions API, Google offline conversions) is the follow-up; both need the studio's ad account credentials.
- **Banners** have an image, an optional link (package, category, class type, gift cards, referrals or a web address), a placement, an audience (everyone, new clients, or a segment) and an optional start and end. Views and clicks are counted.
- **Announcements** are service messages: a title, a short message, info or important, for everyone or clients of one location, shown on the app's front page for a chosen time (2 hours to a week, or a set date) with an optional push. Front desk can post them. Ending one early cancels pushes not yet sent.
- **Gift cards** are studio credit. Buy to give later (waits in the Gift cards tab for the studio's "give within" days, then becomes the buyer's own credit) or give now by email or phone (the person needs an account; if not, the buyer is told and can give it later). Validity starts when it's given. Credit can't buy gift cards.
- **Studio credit** comes from gift cards, referral rewards, journeys or staff top-ups. Each piece has its own expiry and the soonest is used first. Checkout takes credit and an optional one-time discount off; if nothing's left to pay the order completes straight away. Cancelling an order puts both back.
- **Referrals.** Every client gets a code and link. New members add a code when they join, or within the studio's grace period (default 7 days) before their first purchase; staff can add one any time. This is more forgiving than "at sign-up only", but still stops people adding a code after they've already paid. The referrer is rewarded when the friend attends N classes, spends an amount, or buys a package within the time allowed. Rewards: studio credit, free classes, or a one-time discount, with an optional welcome gift for the friend. Self-referrals (same account, email or phone) are refused, and there's an optional monthly cap.

## Loyalty: how it works

- **The studio names its points** ("Petals", "Sweat Points", "Stars"…); the plural is filled in automatically and can be changed. Everything clients see uses the name: "You've got 120 Petals".
- **Earning:** either per class attended (e.g. 10 per class; correcting attendance takes them back) or per amount spent (e.g. 1 per SGD 1 on packages and gift cards; money refunded takes them back). Studio credit, rewards and free classes never earn points.
- **Rewards:** free classes, a discount, studio credit, a gift card (lands in their Gift cards tab to give or keep), or "something special" handed over in person (a smoothie, a tote, a private session). In-person rewards get a short code to show at the desk; front desk marks them given, or cancels and the points go back. Rewards can have limited stock.
- **Expiry (recommended: after a stretch without visits).** All points expire only if a client doesn't come to a class, earn or redeem for N months (default 12). Regulars never lose points, and points still nudge lapsed clients back. The alternatives are "each point lasts N months" (oldest used first) or "never expire". Clients get a reminder two weeks before anything expires. Expiry is worked out from the current setting, so changing it applies to everyone straight away.
- Staff can add or remove points with a reason; "Loyalty points" is a segment filter.
