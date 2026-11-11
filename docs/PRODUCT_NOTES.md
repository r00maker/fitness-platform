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

## Suggested next features (roughly in priority order)

1. **Pricing & payments** (on hold): memberships, class packs/credits, drop-ins, Stripe checkout. Refunds and fees are recorded today but no money moves until this exists. A weekly limit per membership type plugs in here.
2. ~~Booking rules~~: built (booking window, optional weekly limit, late-cancel and no-show fees).
3. **Closures & holidays**: block out dates so recurring classes skip them, with one action to cancel a whole day and notify everyone.
4. **Spot / equipment selection**: reformer #3, bike #12, mat position. A big differentiator for pilates and cycling studios.
5. **Instructor qualifications**: who can teach which class type. Cover requests then only go to people who can actually teach it.
6. **Self check-in**: a QR code at the front desk or a tablet kiosk that marks attendance automatically.
7. **Notification preferences**: per-person email/push choices, quiet hours, and a single digest when an admin bulk-changes many classes.
8. **Calendar sync**: a private iCal feed so instructors and clients see their classes in Google/Apple Calendar.
9. **Instructor pay**: rates per class or per head, plus a payroll export.
10. **Reports**: fill rate, waitlist-to-booking conversion, no-show rate and popular time slots.
11. **Waivers & intake forms** before a client's first class.
12. **Virtual/hybrid classes** with a livestream link sent only to booked clients.
13. **Offline attendance** in the mobile app for studios with poor signal, syncing when back online.
14. **Translations**: wording already lives in one file (`packages/shared/src/fields.ts`), ready to translate.
