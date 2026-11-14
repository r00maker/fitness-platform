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
3. ~~Closures & holidays~~: built (see below).
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
- **Ads.** See *Ads funnel* below.
- **Banners** have an image, an optional link (package, category, class type, gift cards, referrals or a web address), a placement, an audience (everyone, new clients, or a segment) and an optional start and end. Views and clicks are counted.
- **Announcements** are service messages: a title, a short message, info or important, for everyone or clients of one location, shown on the app's front page for a chosen time (2 hours to a week, or a set date) with an optional push. Front desk can post them. Ending one early cancels pushes not yet sent.
- **Gift cards** are studio credit. Buy to give later (waits in the Gift cards tab for the studio's "give within" days, then becomes the buyer's own credit) or give now by email or phone (the person needs an account; if not, the buyer is told and can give it later). Validity starts when it's given. Credit can't buy gift cards.
- **Studio credit** comes from gift cards, referral rewards, journeys or staff top-ups. Each piece has its own expiry and the soonest is used first. Checkout takes credit and an optional one-time discount off; if nothing's left to pay the order completes straight away. Cancelling an order puts both back.
- **Referrals.** Every client gets a code and link. New members add a code when they join, or within the studio's grace period (default 7 days) before their first purchase; staff can add one any time. This is more forgiving than "at sign-up only", but still stops people adding a code after they've already paid. The referrer is rewarded when the friend attends N classes, spends an amount, or buys a package within the time allowed. Rewards: studio credit, free classes, or a one-time discount, with an optional welcome gift for the friend. Self-referrals (same account, email or phone) are refused, and there's an optional monthly cap.

## Ads funnel: how it works

From an ad to a paying client, and back to the ad platform so the ads find more people who pay.

- **Where people come from.** Ad click ids (`fbclid`, `gclid`) and UTM tags are saved when someone joins, so "Came from: Meta ads / Google ads" works in segments and journeys.
- **Lead forms → Leads.** Meta Lead Ads (Facebook and Instagram) and Google lead form ads send each enquiry straight in. Meta's webhook is signed with the platform's app secret and the lead's details are read with the studio's Page token; Google's carries a key that only the studio knows. The same person isn't added twice (same form entry, or the same email or phone still open from the last 90 days), and someone who's already a client is marked as such and isn't chased. Staff can add walk-in or phone enquiries by hand. Leads Google marks as tests are kept but never emailed.
- **Follow-up.** Optional: a first email (one of the studio's saved emails) sent straight away with the lead's own sign-up link (`{{join_link}}`), one reminder after N days if they haven't joined, and an alert to the owner, admins and front desk so someone can call. Lead emails say why they're getting it ("you asked … about classes") and have a "Stop these emails" link. Leads are never put on marketing lists until they join and say yes themselves.
- **Matching.** When a lead joins (from their link, or with the same email or phone), the lead becomes *Joined* and their "Came from" is set to the ad platform. Their first paid package marks them *Bought*, with the amount.
- **Results back to the platforms.** Sign-ups and first purchases of people from Meta (by lead or click) go to Meta's Conversions API as *CompleteRegistration* and *Purchase*, with email, phone and names hashed (SHA-256) as Meta requires; nothing readable is sent. Retries up to 5 times and shows the last error in settings. For Google, the studio adds a scheduled import in Google Ads (Goals → Conversions → Uploads) pointing at its private CSV address; Google matches by click id. This avoids needing a Google developer account. Only one sign-up and one first purchase per person are ever reported.
- **Funnel report.** Leads → joined → bought and first-purchase revenue per platform and per campaign, plus people who joined straight from an ad without a form.
- **Security and privacy.** Access tokens are encrypted at rest (AES-256-GCM with the server's `SECRETS_KEY`) and never sent back to the app, only "connected". Webhooks, the CSV address and the keys are checked in constant time; keys can be replaced in one click if shared by mistake. Deleting a lead erases it and any emails still waiting to go.
- **Set-up for the platform (once):** `SECRETS_KEY` (64 hex characters), and for Meta a Meta app with the *leadgen* webhook pointed at `/v1/public/ads/meta/webhook` (`META_APP_SECRET`, `META_VERIFY_TOKEN`). Each studio then connects its own Page, dataset (pixel) and Google account in Marketing → Ads & leads.

## Loyalty: how it works

- **The studio names its points** ("Petals", "Sweat Points", "Stars"…); the plural is filled in automatically and can be changed. Everything clients see uses the name: "You've got 120 Petals".
- **Earning:** either per class attended (e.g. 10 per class; correcting attendance takes them back) or per amount spent (e.g. 1 per SGD 1 on packages and gift cards; money refunded takes them back). Studio credit, rewards and free classes never earn points.
- **Rewards:** free classes, a discount, studio credit, a gift card (lands in their Gift cards tab to give or keep), or "something special" handed over in person (a smoothie, a tote, a private session). In-person rewards get a short code to show at the desk; front desk marks them given, or cancels and the points go back. Rewards can have limited stock.
- **Expiry (recommended: after a stretch without visits).** All points expire only if a client doesn't come to a class, earn or redeem for N months (default 12). Regulars never lose points, and points still nudge lapsed clients back. The alternatives are "each point lasts N months" (oldest used first) or "never expire". Clients get a reminder two weeks before anything expires. Expiry is worked out from the current setting, so changing it applies to everyone straight away.
- Staff can add or remove points with a reason; "Loyalty points" is a segment filter.

## Appointments, colours, repeats and ClassPass: how they work

- **Appointments** are a kind of class type (Class types → "Appointment"), for private sessions such as one-to-ones and duets. They never appear on the public schedule. A client only sees an appointment they're booked into, and clients can't book appointments themselves. Staff create them with **+ New appointment** on the schedule and can add the client(s) straight away. That's optional, but leaving it empty asks first ("No client added"), since appointments are usually only booked once a client has confirmed. Appointments have no waitlist. Their size defaults to the number of clients added (1 if none). Packages, clashes and the weekly limit are checked as for any booking.
- **Colours.** Each class type has a colour, picked from a palette of 12 or typed as a hex code. Colours too light for white calendar text are refused, with a suggestion to pick a darker shade.
- **Repeats.** Classes and appointments can repeat when created: on chosen weekdays, every 1–8 weeks, ending on a date, after a number of sessions, or never. A repeating appointment books its client(s) into every date, with one confirmation rather than one per date. Dates the background job adds later are booked in too. A date that can't be booked (e.g. the person is no longer a client) is left open for staff.
- **ClassPass per class.** In the class creator: "Take ClassPass bookings" and "Spots for ClassPass". The number is the most ClassPass can take; any spots ClassPass doesn't fill stay open to members, and ClassPass is never offered more than the class has free. Templates and repeats carry the setting; appointments can't take ClassPass. ClassPass bookings are marked as such, need no package, and aren't charged studio late-cancellation fees (ClassPass handles those). They're changed in ClassPass, so they can't be moved to another class. Lowering the spots below what's already booked asks first; those bookings stay.
- **Connecting ClassPass.** ClassPass works with booking software through its partner integration programme. The platform applies once as a software partner. After approval, ClassPass reads each class's open ClassPass spots and sends bookings and cancellations, and each studio links its ClassPass venue in settings. The data model is ready for this: spots per class, `classpassView` (taken and available), bookings with the source `classpass`, and `GET /classpass/spots`. Until the connection is approved, staff manage spots from the dashboard, keep ClassPass in step using the ClassPass spots list, and add each ClassPass booking with "Booked through ClassPass", which uses up one of the class's ClassPass spots.

## Appointment packages, auto-cancel, staff, leads, goals, WhatsApp and reports

- **Appointment packages.** Booking into an appointment needs a package that lists that appointment type (e.g. "Private Reformer ×5"). Group class packs, including "every class" ones, don't cover appointments. Without one, staff are told to sell one first or book it as complimentary. Clients see appointments in their own tab under My bookings, with the package that pays for them.
- **Auto-cancel.** Set on a template ("cancel if fewer than 3 are booked 12 hours before") and copied to each class, where it can be changed or switched off. The worker checks each class once, at the cut-off. If it's cancelled, everyone booked gets their class back and is told why, the waitlist closes, and the owner, admins and instructor are told. Changing a class's time or rule checks it afresh. Appointments are never auto-cancelled.
- **Deleting class types.** Refused while the type is on the calendar (upcoming classes or a running repeat), with a link to show them. Otherwise it asks first, removes the type, deletes its templates, and takes packages that only cover it off sale. Past classes keep their name and colour.
- **Adding staff.** Owners and admins add staff by name, email and role. The person gets an email with a link to set their own password with the sign-in provider (no two-step code for staff). Links are random, stored only as a hash, single-use, and last 7 days; they can be re-sent or cancelled. Only the owner adds or removes admins. Nobody can remove the owner or themselves, and a client's email can't double as a staff sign-in. Removing someone takes their access away at once.
- **Leads.** Leads is its own menu item. It covers ad enquiries, walk-ins and ClassPass clients: a client's first ClassPass booking adds them as a lead, marked as booking through ClassPass, with no emails sent. When they buy one of the studio's own packages they're marked Bought and become a studio member. Existing ClassPass clients were added by the migration.
- **Journey goals.** Each journey can have a goal (buys a package, books a class, attends a class). Reaching it ends that person's journey at once and counts as a conversion, shown as "21 of 38 reached the goal (55%)". A goal that's the same as a "Wait for" step is refused, because that step's Yes side could never run.
- **WhatsApp.** Uses Meta's WhatsApp Cloud API with the studio's own number. Setup:
  1. The studio creates a WhatsApp Business account in Meta Business Suite, adds a number and verifies the business.
  2. It pastes the phone number ID, the business account ID and a system-user access token (stored encrypted).
  3. It creates message templates in WhatsApp Manager and syncs them here.
  
  Journeys get a "Send a WhatsApp message" step: pick a template and fill its blanks with details like {{first_name}}. Messages go only to clients who said yes to WhatsApp messages (a new consent, off by default) and have a mobile number. They go through the same outbox as email and push, with retries. Replies, two-way chat and an inbox need the incoming-messages webhook, which is the next step.
- **Reports.** Five tabs, one question each:
  - Overview: how is the studio doing?
  - Sales: where does the money come from?
  - Classes: what fills up, and what doesn't?
  - Clients: are people coming back?
  - Conversion: are new people turning into paying clients?
  
  Every number is compared with the period before ("Up 12%", marked good or worth watching), has one plain sentence explaining it, and sits under a one-line summary. Money is nett: packages, gift cards and fees, minus money refunded. Appointments are counted apart from classes. Charts use one colour, show their amount on hover, and can be shown as a table.

## Bookings without a package, bulk changes, instructor reports and the Communication inbox

- **Bookings without a package.** A new Studio rule, "Allow bookings without a package" (on by default, which is how it worked before), applies to classes and appointments alike.
  - On: staff are asked first, then the booking shows as "Pay at studio".
  - Off: a covering package is always needed. Staff can still book someone in for free as complimentary, and clients booking themselves always need a package.
- **Changing many classes.** Choose classes picked on the calendar, or any filter covering up to 13 months:
  - dates
  - classes or appointments
  - class types
  - instructors (including TBC)
  - location, rooms, weekdays and start times
  - one repeating schedule

  A live count shows how many classes match and how many people are booked. You can then change anything the class creator can: class, instructor (or cover), location and room, start time, length, spots, waitlist, ClassPass, auto-cancel and notes. Each field defaults to "Keep as is". The same filter can cancel classes. The usual checks still apply: clashes, rooms too small, spots below the number already booked, and booked clients being told. The limit is 2,000 classes at a time.
- **Instructor reports.** A new Instructors tab lists everyone who teaches: classes, booked per class, how full, no-shows, covers and appointments, with the change on the period before. Clicking someone opens their numbers, a weekly trend, their classes by type, their regular slots and their regulars. Instructors can see their own report only. The Classes report can also be narrowed to one instructor, class type or location.
- **Communication inbox.** A new menu item for owners, admins and Front of House, covering WhatsApp now and email next.
  - **Coexistence.** The studio keeps its WhatsApp Business app number and app. It connects through Meta's sign-up window, scanning a code in the app, and chats from the last 6 months can be brought across. Replies sent from the phone appear in the thread too.
  - **Using the inbox.** Threads are linked to clients by phone number; unknown numbers can be added as leads. Threads can be assigned, closed and searched.
  - **Paying Meta comes first.** Before anything can be sent, the studio chooses how Meta's charges are paid:
    - **Pay Meta directly:** the studio adds a card in WhatsApp Manager and confirms it here. Meta bills the studio.
    - **Buy message credits:** the studio buys credits here and we pay Meta. Credits are added only once the payment goes through, each charged message uses them at the platform's rate card, and failed messages are refunded. This option only appears once the platform is set up to pay Meta for studios: it needs a rate card, and in practice Meta Solution Partner status or a partner BSP with a credit line. Until then, studios pay Meta directly.
  - **What's charged.** Free replies are allowed for 24 hours after the client's last message. After that only approved templates can be sent, and the app shows what Meta will charge before anything goes out. Marketing templates need the client's yes to WhatsApp messages.
  - **Journeys** use the same payment check and credits, and their messages appear in the client's thread.
  - **Platform setup:**
    - A Meta app (`META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`) with Embedded Signup configured for coexistence.
    - The webhook at `/v1/public/comms/whatsapp/webhook`, subscribed to `messages` and `smb_message_echoes`.
    - Meta's Tech Provider review, so other businesses can connect through the app.

## Reports zoom, Edit many, the menu, agents and the assistant

- **Reports zoom:** the Classes tab has a **Zoom in** bar: class type, location, instructor, days of the week and time of day (mornings before 12pm, afternoons 12pm to 5pm, evenings from 5pm, in the studio's time zone). Every number on the tab follows it. It also shows how full each location was and a "When classes are busiest" grid (day × time of day); tapping a box zooms into it. API: `GET /reports/classes?weekdays=1,3&timeOfDay=evening&locationId=…&classTypeId=…&instructorId=…`.
- **Edit many:** one button replaces "Change many" and "Select classes". It opens the same window either way: choose classes with filters, or **Pick on the calendar** (tap classes, then **Next: change or cancel**).
- **The menu** is grouped by what you're doing: Day to day, Clients & sales, Growth, Team, Setup, Account (clients see Classes, Packages & rewards, Account).
- **Reminder agents** (Team → Agents): pick a ready-made agent (cover reminders, quiet classes the night before, tomorrow's line-up, classes with no instructor, busy waitlists, unfilled cover), name it, and adjust three blocks: when it runs (a set time, or hours before each class), what it checks, and who it tells. Owners and admins choose what each agent can see (class times, who teaches, booking numbers, cover). Safeguards, enforced in the API rather than the set-up:
  - there's no way for an agent to read client names, contact details, health notes, payments, packages or pay, or another studio's data;
  - it only messages staff of the studio (push to the staff app, plus the bell in the app), never clients;
  - each person only hears about what they could see themselves, so instructors only hear about their own classes;
  - agents never change anything; anyone can mute an agent for themselves; **Pause all** stops every agent; **Preview** shows what it would send without sending.
  Agents are built from these blocks so studios can later put their own together (or describe one in words and have the assistant fill in the blocks for them to check).
- **The assistant** (the Ask button, staff only): answers questions from the help guide and the studio's own data, as the person asking. Example: "Why can't I book Dev Kumar into Saturday's 11am Reformer class?" looks up the client and class and runs the real booking rules without booking anything, then explains the reason. It can offer to book a client in, add them to a waitlist, or cancel a free-to-cancel booking; nothing happens until the person presses Confirm, and it then runs with their permissions and the usual warnings. It never handles money (refunds, payments, prices, selling packages, fees, pay), settings, staff, deletions, contact details or health notes, and says who can do it and where instead. A booking that would be "Pay at studio" because there's no package, or a late cancellation, is left to a person. Owners and admins can switch it off, choose which roles can use it, and stop it doing things for people.
- **Allowance:** each plan includes a number of assistant replies a month (default 300; one per answer, however much it looks up). Owners and admins are told at 80% and 100%. Top-ups (placeholder prices) are added once payment is confirmed and don't expire. Reminder agents don't use the allowance.

## Sales, membership holds, shop, writers, email, exports

- **Invoices and receipts:** every checkout, renewal, gift card, shop order, desk sale and fee gets an invoice; a receipt number is added when it's paid. Numbers are per studio, sequential and never reused. The seller's details are copied onto each invoice when it's issued, so changing the design later doesn't rewrite old invoices. Tax is shown as "includes" (prices are tax-inclusive, as is usual in the region).
- **Refunds** live on the Sales page: part or full, back the way they paid or as studio credit, optionally cancelling what was bought (package, unused gift card, shop items back in stock). The app records card refunds; the money moves through the studio's terminal or provider.
- **Failed membership payments:** booking with a held membership is refused with a plain reason. 7-day hold, retries on days 3 and 7, then the membership ends, bookings made with it are cancelled, and any early termination fee is charged. Rebuying starts a new minimum term.
- **Shop:** merch with sizes or colours and stock; collect at the desk; pay then or with credit. **Gift cards moved into the Shop** (admin settings under Shop, Gift cards; clients buy them from the Shop) because both are things clients buy outright, unlike packages. The client Shop hides itself when there's nothing to sell.
- **Writers:** announcement writer (1 credit) and campaign drafter (3 credits) use low effort and structured output to keep cost down, write in the studio's voice from its recent examples, leave [placeholders] instead of inventing facts, and only ever produce drafts. "Assistant replies" are now "AI credits".
- **Email inbox:** Gmail and Outlook only for now, via each provider's sign-in (no passwords stored). Emails join the same inbox as WhatsApp; no 24-hour window or message charges apply.
- **Report exports:** CSV follows the current tab, period and zoom (formula-safe, opens in Excel with the right characters); the visual report is a one-page summary to print or save as PDF.
- **Calendar:** double-click an empty time to add a class, drag a class to move it; both ask first. Classes can have **no room** (for one-space studios). Class types list classes and appointments separately. The Categories window is now one row per category; open one to edit it.
- **Journey goals** are simplified to three choices (books a class, comes to a class, buys a package). A goal no longer clashes with a matching "Wait for" step: reaching it carries the person down that step's Yes side.

## Closures and holidays: how they work

- **A closure** is a name, a first and last day (inclusive, in each location's own dates) and either one location or all of them, with an optional message for clients. Admins manage them under Setup, Closures & holidays (`/closures`). Up to a year long; days that have already passed are refused.
- **Adding one cancels the classes already on those days** in one transaction, after a single "Classes will be cancelled" confirmation that says how many classes and bookings are affected (instead of one warning per class). Only classes that haven't started are touched. The refund choice and "Tell clients" work as for any cancellation. Studios can untick "Cancel the classes" to keep them (a special event); recurring classes still skip the days.
- **One message per person.** Each client gets one email and push listing every class of theirs that was cancelled (or the waitlists they were taken off); each instructor gets one listing what they were teaching. This is the first step towards the "single digest" idea under notification preferences.
- **Recurring classes skip closed days,** both when a series is created (with a note listing the dates left out) and when the worker tops up open-ended series later. Skipped days don't count towards a set number of classes, so a 6-class course still gets 6.
- **Adding or moving a single class onto a closed day** raises a "closed_day" check rather than refusing it. Editing something else about a class kept on a closed day (like the instructor) doesn't ask again.
- **Removing a closure** puts back the recurring classes it left out (from today on, unless another closure still covers the day). Classes it cancelled stay cancelled: people were told and refunded, so silently bringing classes back would confuse them. Courses with a set number of classes already made up the missed class at the end, so nothing is added to those. Editing a closure only changes its name and message; changing dates is remove-and-add, so what happens to classes is always clear.
- **The calendar** returns the closures in view, so the apps shade closed days and show the name and message, for clients too.

