# The client web app

`apps/web`: what a studio's clients use in the browser (and on their phones' browsers): the studio's booking page, booking, buying, and their account. It runs on the real API; the preview (`preview/`) stays the design reference for new screens.

Built with Vite, React 18, TypeScript and React Router. No state library: each page loads what it shows from the API.

## Pages

| Address | What |
|---|---|
| `/s/<slug>` | The booking page: the studio, the timetable (a week, day by day; location and class filters; spots left), and the Packages tab. Public. |
| `/s/<slug>/classes/<id>` | One class: when, where, instructor, spots, the packages that cover it, and **Book**. |
| `/s/<slug>/packages/<planId>` | Checkout: the terms, price, studio credit, how to pay (online, or a method with its fee, or at the studio), then Stripe's page or the order. |
| `/s/<slug>/sign-in` | Email and a 6-digit code (or Google, Apple). New people get an account. |
| `/s/<slug>/join` | Signed in but new to this studio: name, mobile, a referral code, and their choice about news and offers. |
| `/s/<slug>/me`, `/me/packages`, `/me/payment` | My bookings (cancel, with the late-cancellation check), My packages (classes left, renewals, payment holds), Payment method (the card kept for memberships). |
| `/payments/done`, `/payments/cancelled`, `/payments/card-saved` | Back from Stripe: waits for the API to hear from Stripe, then says it's paid. |

## How booking works

1. A visitor opens a class and taps **Book**. Not signed in: sign-in, then (if new to the studio) joining, then straight back to the class, which carries on booking by itself.
2. The API's rules decide everything. The app shows what the API says:
   - **The waiver** (first time only) is signed on its own first, so it isn't lost if the booking then needs something else.
   - **No package that covers it:** the packages that do are right there; buying one returns to the class and books it.
   - **"Please check"** (a class within the cancellation window, and others): shown with the API's own words, and **Book it** sends them back acknowledged.
   - **Full with a waitlist:** joins the waitlist.
3. Cancelling from My bookings works the same way (the late-cancellation check comes from the API).

After signing in, the app only follows links back into the same studio's pages.

## Sign-in: Supabase Auth

Recommended because:
- its user ids are UUIDs, which the API uses as our own user ids, so there's nothing to map;
- email codes, Google and Apple sign-in, with confirmed emails;
- it publishes signing keys (JWKS), which is how the API checks tokens;
- a Singapore region, and a free tier that covers a pilot comfortably.

The app keeps the session; every API call sends the token and the studio (`X-Studio-Id`). The API reads the person's role from its own records, so neither can grant anything (see `apps/api/src/plugins/auth.ts`).

### Setting it up

1. Create a Supabase project in the Singapore region. Only its Auth is used (the database can be anywhere).
2. **Authentication → Sign In / Providers:** Email on; turn on Google and Apple when their developer apps exist.
3. **Authentication → Email templates → Magic link / OTP:** include `{{ .Token }}` so the email carries the 6-digit code.
4. **Authentication → URL configuration:** the web app's address as the Site URL, and `<web app>/s/*` as a redirect URL (for Google and Apple).
5. **Project settings → JWT signing keys:** use asymmetric keys (new projects do), so there's a JWKS address.
6. The API: `AUTH_JWKS_URL=https://<project>.supabase.co/auth/v1/.well-known/jwks.json`, `AUTH_ISSUER=https://<project>.supabase.co/auth/v1`, `AUTH_AUDIENCE=authenticated`.
7. The web app: `VITE_AUTH=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the public anon key, made for browsers), `VITE_API_URL`.
8. The API's `CORS_ORIGINS` includes the web app's address, and `PUBLIC_APP_URL` is the web app's address (Stripe and the booking widget link back to it).

## Running it locally

```bash
pnpm --filter @studio/web dev
```

With `VITE_AUTH=dev` (the default), sign-in takes any email and the code `000000`: the API gives a token from `/v1/dev/sign-in`, which only exists when no real sign-in provider is configured and never in production.

## Tests

- `pnpm --filter @studio/web test`: unit tests (the API client, safe links after sign-in).
- `pnpm --filter @studio/web e2e`: the whole flow in a real browser, desktop and phone, against the real API on a throwaway database (`studio_e2e`, wiped each run; `apps/api/src/scripts/e2e-server.ts` seeds a studio). A new person finds a class, signs in, joins, signs the waiver, is told they need a package, buys one (paid at the desk, marked paid by the studio), books with the "please check" step, sees it in My bookings, cancels (late), and checks My packages and Payment method. 42 checks; screenshots in `apps/web/e2e/shots`.

## Not built yet

- Paying online in the end-to-end run (it needs Stripe's page in a browser; the API side was tested live in test mode).
- Gift cards, the shop, rewards, referrals, reviews and feedback pages (the API has them; the preview shows the screens).
- Sharing packages, extensions and rollovers from the client's side.
- Push notifications and the phone apps (React Native with Expo, next).
