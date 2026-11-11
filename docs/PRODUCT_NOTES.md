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

- **Waivers** are on by default and can be switched off under Studio rules. Studio members sign in the app (tick and typed name) at their first booking or when joining a waitlist, and never again. ClassPass clients are checked at the studio: Front of House, admins or the class's instructor mark them done after a "have you checked?" confirmation. Admins can also mark a studio member done (for example, a paper copy). Only admins can undo a completed waiver, and the record is kept. When studios change their wording, existing signatures stay valid and each signature records the version signed.
- **Health notes** (injuries, pregnancy, postnatal, recent surgery, medical conditions) are written by the client in plain English, either when booking or under "Injuries & conditions". The type is suggested from the wording on the device, so health details aren't sent to an outside service to be classified. The client can change the suggested type. Notes stay until resolved. When booking, a client is only asked "Still the same?" once a note is over 30 days old. Instructors see active notes for their own classes, and resolved notes drop off straight away. Clients can delete notes. Notes are never put in emails or push messages, and the audit log records that a note changed, never what it says.
- **Class lists show what matters first:** no waiver (in red), health notes, first class and up to two pinned tags ("+N" for the rest). Everything else is behind a tap.
- **Cover:** instructors can ask for cover but don't choose who covers. Their request goes to the class's teaching list and admins are told. Admins choose who to ask, approve offers or assign someone directly.
- **Favourite instructor filter:** clients tap one chip to see only that instructor's classes.

## Suggested next features (roughly in priority order)

1. **Pricing & payments** (on hold): memberships, class packs/credits, drop-ins, Stripe checkout. Refunds and fees are recorded today but no money moves until this exists. A weekly limit per membership type plugs in here.
2. ~~Booking rules~~: built (booking window, optional weekly limit, late-cancel and no-show fees).
3. **Closures & holidays**: block out dates so recurring classes skip them, with one action to cancel a whole day and notify everyone.
4. ~~Spot / equipment selection~~: built, and studios can switch it off.
5. ~~Instructor qualifications~~: built as teaching lists.
6. **Self check-in**: a QR code at the front desk or a tablet kiosk that marks attendance automatically.
7. **Notification preferences**: per-person email/push choices, quiet hours, and a single digest when an admin bulk-changes many classes.
8. **Calendar sync**: a private iCal feed so instructors and clients see their classes in Google/Apple Calendar.
9. **Instructor pay**: rates per class or per head, plus a payroll export.
10. **Reports**: fill rate, waitlist-to-booking conversion, no-show rate and popular time slots.
11. ~~Waivers~~: built. **Intake forms** (longer health questionnaires) could build on health notes later.
12. **Virtual/hybrid classes** with a livestream link sent only to booked clients.
13. **Offline attendance** in the mobile app for studios with poor signal, syncing when back online.
14. **Translations**: wording already lives in one file (`packages/shared/src/fields.ts`), ready to translate.
