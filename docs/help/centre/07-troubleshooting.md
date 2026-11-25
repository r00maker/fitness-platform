---
id: cant-book-client
title: I can't book a client into a class
category: Troubleshooting
summary: The message says why. Here's what each reason means and what to do.
keywords: can't book, cannot book, booking failed, won't let me book, error booking, no package, class full, waiver, weekly limit, booking window, not allowed
---
When a booking can't be made, the message says why. The usual reasons:

- **The class is full.** Add them to the waitlist instead.
- **They're already booked** into that class.
- **No package covers the class.** Their package may have run out, expired, or not cover that class type. Sell them a package first. If your studio allows it (Studio rules, "Allow bookings without a package"), you can book them as **Pay at studio**, or book it as complimentary.
- **They haven't signed the waiver.** Members sign in the app at their first booking. Front of House or an admin can mark a paper waiver as done.
- **They've reached the weekly limit.** Owners and admins can go over it, after a warning.
- **Outside the booking window** (for example, more than 14 days ahead, or less than an hour before). Owners and admins can still book people in, after a warning.
- **The class has finished or was cancelled** (for example by a closure).
- **Appointments** always need a package that covers appointments.
- **ClassPass:** the class doesn't take ClassPass, or its ClassPass spots are taken.
- **Your role:** only owners and admins can book clients in.

Still stuck? Ask the assistant: "why can't I book [name] into [class]?". It checks their packages, the waiver and the rules for you.

---
id: client-cant-book
title: A client says they can't book
category: Troubleshooting
summary: The most common reasons a client can't book in the app, and how to sort each one.
keywords: client can't book, member can't book, app won't let me book, booking greyed out, no book button, membership on hold, package expired, sold out
---
Check these, in order:

1. **Their package or membership.** Open the client under **Clients**: has the package run out or expired, or doesn't it cover that class type? A membership **on hold** means a renewal payment failed. See [When a membership payment fails](#failed-renewals).
2. **The booking window.** Booking may not be open yet for that class, or it may have closed. The class shows when booking opens.
3. **The class is full.** They can join the waitlist.
4. **The weekly limit.** They may have booked the most classes allowed for that week.
5. **Signed in to the right account?** If they signed up with a different email, they'll see a different account with no packages.

If it's something you can fix (a package, the waiver, going over a limit), you can book them in yourself. See [Booking a client into a class](#book-a-client).

---
id: attendance-locked
title: I can't change attendance
category: Troubleshooting
summary: Attendance locks at midnight after class. Who can still change it, and what it affects.
keywords: attendance locked, can't change attendance, mark present, undo no show, wrong attendance, check in mistake, locked
---
Attendance opens an hour before class and **locks at midnight at the end of the class's day** (in the location's time zone).

- **Instructors and Front of House** can't change it once it's locked.
- **Owners and admins** still can, after a warning, because changing it adds or removes a no-show fee.

If the client already paid a no-show fee that's now wrong, refund it under **Money, Sales**. See [Refunds and fees](#refunds-fees).

---
id: fee-changed
title: A no-show fee appeared or disappeared
category: Troubleshooting
summary: No-show fees follow attendance until it locks at midnight.
keywords: fee disappeared, fee removed, fee appeared, wrong fee, no-show fee, late fee, final after midnight, charged by mistake
---
A **no-show fee** follows attendance until attendance locks at midnight at the end of the class's day:

- marking someone as a no-show adds the fee;
- correcting them to present before midnight removes it.

Until then, the Fees page shows the fee as **Final after midnight**, and collecting it asks you first.

**A late-cancellation fee** is different: it's added when someone cancels inside the late-cancellation window, and it's final straight away. Admins can waive it under **Money, Fees**.

---
id: menu-missing
title: I can't find a page or menu item
category: Troubleshooting
summary: Your role, your plan and your studio's features decide what's in the menu.
keywords: missing menu, can't find, where is, page missing, not in menu, hidden, disappeared, no access, greyed out
---
Three things decide what's in your menu:

1. **Your role.** Front of House and instructors see fewer pages than owners and admins. See [Who can do what](#who-can-do-what).
2. **Your studio's features.** Anything switched off under **Setup, Features** is hidden. Ask an owner or admin to switch it on.
3. **Your plan.** Some features come with Growth or Signature. They're marked with the plan that has them under Setup, Features.

**Looking for something specific?** Many pages are tabs inside another menu item. For example, Fees and Shop are tabs in **Money**, and Studio rules is a tab in **Setup**.

---
id: payments-not-working
title: Online payments aren't working
category: Troubleshooting
summary: Clients can't pay online, or a payment method is missing.
keywords: payment not working, can't pay online, card not working, paynow missing, stripe not connected, checkout error, payment failed, no pay button
---
Check these under **Setup, Payments**:

1. **Is Stripe connected and verified?** After connecting, Stripe checks your details, usually within minutes. If it needs more information, it says so on the Payments page; finish it in Stripe.
2. **Are online payments switched on?**
3. **A payment method is missing** (for example PayNow or GrabPay): which methods clients see is set in your Stripe dashboard, under Settings, Payment methods.

**A single client's card was declined:** that's between them and their bank. They can try another card, or pay at the studio if you allow it. For memberships, see [When a membership payment fails](#failed-renewals).

---
id: refund-not-arrived
title: A client's refund hasn't arrived
category: Troubleshooting
summary: How long refunds take, and where to check.
keywords: refund not received, where is my refund, refund pending, refund delay, money not back, paynow refund
---
- **Card refunds** are sent through Stripe straight away. Banks usually take 5 to 10 working days to show them on the client's statement.
- **PayNow refunds** can take a few days. If one fails, we'll tell you.
- **Studio credit** is available to the client straight away, in their app.

To check, open the sale under **Money, Sales**: it shows the refund and how it was made. You can also see it in your Stripe dashboard.

---
id: booking-page-not-found
title: My booking page says "not found", or a class is missing
category: Troubleshooting
summary: The booking page is off, the link changed, or the class isn't public.
keywords: booking page not found, link broken, page not working, widget empty, class not showing, timetable missing, website widget not showing
---
- **"Not found":** the booking page may be switched off. Check **Setup, Booking page**. If you changed your link, the old one stops working: update it wherever you shared it.
- **A class is missing:** private sessions (appointments) and cancelled classes are never shown. If the widget is set to one location, classes at other locations aren't shown.
- **The website widget is empty:** check the code was pasted into an "Embed" or "Custom code" block, not a normal text block, and that your booking page is on.

---
id: no-email
title: A client didn't get an email or sign-in code
category: Troubleshooting
summary: Check their address, their spam folder and their preferences.
keywords: no email, didn't receive, email not arriving, code not received, sign in code, verification code, spam, junk, receipt not received
---
1. **Spam or junk folder:** ask them to check there, and mark it as "not spam".
2. **Their email address:** check it under **Clients**. A small typo means emails go nowhere.
3. **Wait a minute** for sign-in codes, then ask for a new one. Codes last an hour.
4. **Marketing emails** only go to people who agreed to marketing. Studio news and receipts go to everyone.

If several clients say the same thing, tell us: it may be a problem on our side.

---
id: ask-cant-help
title: Ask couldn't do what I asked
category: Troubleshooting
summary: What the assistant can and can't do, and what to do instead.
keywords: ask not working, assistant can't, ai won't, assistant refused, out of credits, ai credits used up
---
Ask can book a client in, add them to a waitlist, or cancel a booking that's free to cancel, and only when you press **Confirm**. It won't:

- do anything involving money (refunds, payments, prices, packages, fees, pay);
- change settings, staff or the schedule;
- delete anything;
- share client contact details or health notes.

For those, it tells you who can do it and where.

**It isn't answering at all?** Your studio may have used this month's AI credits. Owners and admins are told at 80% and when they run out, and can buy a top-up. Or Ask may be switched off for your role, in its settings.

---
id: closed-day-class
title: A class landed on a day we're closed
category: Troubleshooting
summary: Closures cancel classes once, and stop repeating classes landing on those days.
keywords: class on holiday, closed day class, closure not working, class still on, holiday class
---
- **Repeating classes skip closed days** from the moment you add a closure.
- **Adding or moving a class onto a closed day** asks you first, in case it's a mistake. If someone went ahead anyway, cancel that class.
- **Kept the classes on purpose?** If you unticked **Cancel the classes already on these days** when adding the closure, those classes stay on.

See [Closures and holidays](#closures).

---
id: pack-start-changed
title: A pack's start or end date changed
category: Troubleshooting
summary: Packs start on the day of the earliest class booked with them.
keywords: start date changed, expiry changed, end date moved, package dates wrong, pack expires earlier
---
That's by design. A pack starts on the day of the earliest class booked with it, so:

- booking an earlier class moves the start (and the end) earlier;
- cancelling the earliest class moves the start to the next one.

This means a client never hears "no package" just because they booked classes out of order. See [Packages and memberships](#packages).
