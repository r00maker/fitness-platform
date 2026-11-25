# Booking on the web

Each studio gets a public booking page, and a timetable widget for its own website. Visitors see classes and packages without signing in; they sign in (or create an account) to book or buy, and the client app takes over with the usual rules and payments. Code: `apps/api/src/modules/booking-page/`. Preview: Setup, Booking page, and the booking page itself (**Open booking page**, or `#book`).

## The studio's link

- Every studio has a link, `<PUBLIC_APP_URL>/s/<slug>` (for example `book.skedoo.io/s/breathe-pilates`). Studios added in HQ get one from their name straight away; others are offered one on Setup, Booking page.
- Links are 3 to 40 lowercase letters, numbers and dashes, unique across studios (a taken link suggests another, like `breathe-pilates-2`), and can't be words the app uses itself (`admin`, `api`, `login`, `s`, `widget`…).
- Owners and admins (`manageSettings`) change it under Setup, Booking page (`GET/PUT /booking-page`), with an on/off switch, a line or two at the top (up to 300 characters) and the colour of buttons (the invoice colour unless set). Changing the link breaks the old one, so it's worth setting once.
- The page is public only when it's saved, switched on and the studio is open (not while it's being set up, paused or cancelled). Otherwise it's "not found".

## What visitors see (public, read-only)

`/v1/public/studios/:slug/...`, no sign-in, rate-limited per address, cached for a minute (five for the studio and packages):

| Endpoint | What |
|---|---|
| `GET /public/studios/:slug` | Name, the line at the top, logo, colour, locations, class types, the rules in brief (when booking opens and closes, cancelling, whether a package is needed, whether paying online is on, the waiver) and contact details. |
| `GET /public/studios/:slug/schedule?date=&days=&locationId=&classTypeId=` | Up to 14 days from today, day by day: each class's time, length, location, room, instructor (first name and initial), spots left, and whether it's open, nearly full (3 or fewer), full with a waitlist, full, not open for booking yet (with the date it opens) or closed; days the studio is closed, with its message; and the link to book. |
| `GET /public/studios/:slug/classes/:id` | One class: description, when and where, instructor, spots, what's needed to book (the cheapest packages that cover it, with their terms), the cancelling rule and the link to book. |
| `GET /public/studios/:slug/packages` | What's on sale, cheapest first, with its terms and a link to buy. |

They show only what a member sees on the timetable: no one's name or booking, appointments stay private, past and cancelled classes are left out.

## Booking and buying

The links go to the client app: `/s/<slug>/classes/<id>` and `/s/<slug>/packages/<planId>`. There the visitor signs in (email link, Google or Apple, through the sign-in provider), joins the studio if they're new (`POST /join`, which records where they came from), and then books or buys with the normal endpoints, so every rule applies: packages, waivers, the booking window, waitlists, payments (online or at the studio; memberships by card).

## The widget

```html
<div data-studio-schedule="breathe-pilates"></div>
<script src="https://api.example.com/v1/public/widget.js" async></script>
```

- Shows the studio's name, day tabs (the first day with classes is chosen) and each class with time, length, instructor, location, spots left and a **Book** button that opens the booking page in a new tab.
- Options: `data-location` (one location's id), `data-days` (1 to 14, 7 by default), `data-theme` (`light`, `dark` or `auto`).
- It lives in a shadow root, so the website's styles don't change it and it doesn't change the website. It sets no cookies, stores nothing and loads nothing else. All text from the API is set as text, never as HTML.
- Setup, Booking page gives the code (with the options), a preview, and the plain link for studios without a website (Instagram bio, Google Business profile).
- Checked in a real browser against the running API, on a page with its own clashing styles, at desktop and phone sizes.

## Security

- The public endpoints and the widget are the only routes any website may read: they answer with `Access-Control-Allow-Origin: *` (GET only, no credentials) and `Cross-Origin-Resource-Policy: cross-origin` (without it, browsers refuse the script on other sites). Every other route keeps the app's own origins and the "same origin" policy.
- Nothing private is in them, and they can't change anything.

## Not built yet

- The web app's pages themselves (the preview stands in): `/s/<slug>`, its class and package pages, sign-in and join.
- An `<iframe>` version for website builders that don't allow scripts (the link works there today).
- Booking appointments from the public page (they're booked with the studio for now).
