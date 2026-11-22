# Handoff

Where the project stands, how to work on it, and the owner's rules. Read this first when picking the work up.

## The product

A booking platform for fitness studios in Southeast Asia (in the space of Momence and Mindbody). Studios run classes, appointments, packages and memberships; clients book in an app. The owner's priorities, in order of what to protect:

1. **User-friendliness:** a low skill cap. Things should be easy to find, hard to get wrong, and confirm before anything with consequences.
2. **Plain English:** short, everyday words that travel across the region. No jargon, no idioms. This applies to UI text, errors, emails, docs and PR descriptions.
3. **Security:** studios' data stays separate, roles are enforced on the server, secrets are encrypted, and AI features never see more than they need.

## What's built (merged to `main` unless marked)

| PR | What |
|----|------|
| #4–#5 | Help tips and menu; waivers and health notes |
| #6 | Packages (lifecycle, extensions, rollovers, memberships) and payroll |
| #7–#8 | Marketing: segments, email builder, journeys, campaigns, banners, announcements, gift cards, credit, referrals, loyalty; rooms and banner rotation |
| #9 | Ads funnel and leads |
| #10 | Scheduling (appointments, colours, repeats, ClassPass, auto-cancel, staff invites) and reports |
| #11 | Communication inbox (WhatsApp coexistence, billing gate, message credits) |
| #12 | Claude API setup documented (`docs/HOSTING_AND_DEPLOYMENT.md`, section 5) |
| #13 | Report zoom, "Edit many", grouped menu, reminder agents, support assistant, light/dark UI audit, security audit |
| #14 | Sales (invoices, receipts, refunds, invoice design), membership payment holds, shop (gift cards moved here), writing agents, Gmail and Outlook inbox, report exports (CSV and visual), rooms optional, simpler journey goals, class types split, calendar double-click/drag, tidier Categories window |
| #16 | Closures and holidays: recurring classes skip closed days, adding one cancels the classes on those days with one message per person, closed days shaded on the calendar, closed-day check when adding or moving a class. Also "Show cancelled" on the calendar, a Cancellations tab on each class, and Home (the staff front page) |
| #17 | Waitlist setting (clients choose, or always automatic / always ask first) and a quick view for extension-request attachments. Also: attendance locks at midnight after each class (no-show fees final then), templates can be deleted, Studio rules save button no longer under Ask. Also reviews (with the Google offer), client feedback, celebration pop-ups for staff, and a fix for the sales chart dropping the current week just after local midnight |
| #18 | Full class names on the calendar: names like "Reformer - Intermediate" wrap instead of being cut short, in every view, on computers and phones |
| #19 | Market review and launch plan (`docs/MARKET_AND_LAUNCH.md`). Feature switches (Setup, Features) and the grouped menu: related pages share one menu item with tabs, 14 admin items instead of 24 |
| Not merged yet | Plans (Essentials SGD 129, Growth SGD 399, Signature SGD 699, app add-on SGD 99; first drafted in USD) set by our staff, with feature, location and admin limits; setup by studio type now comes from the plan; Studio rules search and "Changed from the usual" marks; a getting-started list on Home |

The market review, pricing and launch plan are in `docs/MARKET_AND_LAUNCH.md`. Details of how each area works, and the decisions behind them, are in `docs/PRODUCT_NOTES.md`. The staff-facing guide (also what the support assistant reads) is `docs/help/STUDIO_GUIDE.md`.

### Code layout

- `apps/api`: Fastify 5, Drizzle ORM, Postgres 16, zod 4, luxon, vitest. Modules under `src/modules/<area>/` (routes, services, tests in `apps/api/test`).
- `packages/shared` (`@studio/shared`): schemas, enums, permissions (`can(role, perm)`), field help text.
- `preview/`: the clickable single-file preview and its source (see `preview/README.md`). Published as a private claude.ai artifact: https://claude.ai/artifact/CevsrLzmfYURdwZtrtmiaW
- `docs/`: product notes, hosting and deployment, security review, help guide, this handoff.

### Not built yet / waiting on something

- **Online payments go live:** built (Stripe Connect, `docs/PAYMENTS.md`) and tested end to end against Stripe's test mode (connect, pay, renew, decline, refund). Connect is signed up on the platform's test account. For each environment, set `STRIPE_SECRET_KEY` and the two destinations' signing secrets (`STRIPE_WEBHOOK_SECRET`); for live, repeat Connect and the destinations in live mode. In the cloud sessions, the test key is saved in the "fitness-platform" environment (injected by the network proxy; run scripts with `NODE_USE_ENV_PROXY=1`).
- **Email inbox going live:** needs a Google OAuth app (Google verification before more than 100 users) and a Microsoft app. Steps in `docs/HOSTING_AND_DEPLOYMENT.md`, section 6.
- **The branded client app** (`apps/client`, `docs/CLIENT_APP.md`): what members use day to day, in the studio's own look (presets Studio, Linden, Tidal, Aizome; a studio's own colours, typefaces, corners, celebrations, welcome line and milestones with the branded app). Home has banners, the next class, a tally to the next milestone, the month against the member's own goal, achievements and a celebration when something happened; booking is two taps with one check in the row. Runs on the real API (checked live) and on three demo studios (the showcase). Not yet: buying in the app, waivers in the app, push, the app-store wrappers and the studio's screen for choosing the look.
- **Package dates and memberships** (not merged yet): one-time packages start on the day of the earliest class booked with them (an earlier class moves the start back instead of failing); members can book into next month before it renews (held, then taken at renewal; a Studio rule, on by default). See `docs/PRODUCT_NOTES.md`.
- **The client web app** (`apps/web`, `docs/WEB_APP.md`) runs on the real API: the booking page, booking, buying, sign-in and joining, My bookings, My packages, Payment method. Sign-in is Supabase Auth (to be set up; locally a dev sign-in stands in). The staff web app and the phone apps aren't built yet: the preview stands in for them.
- **What comes next:** `docs/MARKET_AND_LAUNCH.md` has the market review (competitors, a UX audit, pricing, a launch plan) from the MVP milestone. `docs/PRODUCT_NOTES.md` ("Roadmap after the MVP") lists the order: feature-set improvements first (feature switches, setup by studio type, phone flows for clients and instructors, one AI entry point, one "Tell clients" flow), then what blocks launch (payments, data import and web booking with the website widget are all built). Next is "Soon after launch" in the roadmap (self check-in, Xero / QuickBooks, a card reader, location managers, notification preferences), and the real web and mobile apps that the preview stands in for.

## The owner's rules

**Git, GitHub and publishing**
- Push, and open pull requests, **only when asked**. Never merge unless explicitly told to.
- Don't rewrite or force-push `main`. (GitHub's merge commits on `main` show as unverified; that's expected and not something to "fix".)
- If a branch's PR has been merged, restart the branch from the latest `main` under the same name before adding more.
- Commit as Claude with this identity and trailer:
  ```bash
  git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "..."
  ```
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <link to the current session>
  ```
- PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, a blank line, then the session link.
- Create PRs with the API (the repo has no PR template):
  ```bash
  gh api repos/r00maker/fitness-platform/pulls -X POST -f title="..." -f head=<branch> -f base=main -F body=@pr.md --jq '.html_url'
  ```
- Check `main` with `git ls-remote origin main` and update with `git pull origin main` (or `git fetch origin main:refs/remotes/origin/main`).
- Don't put model names or identifiers in commits, PRs or code.

**Privacy and security**
- Never commit `.env` files or secrets. `apps/api/.env.example` lists settings without values.
- Never put the owner's name, email or other personal details into requests to outside services.
- Refer to people whose pronouns you don't know as they/them.

**How to work**
- Every feature comes as a pair: the backend (with tests) and the preview (with a Playwright check), then docs (`PRODUCT_NOTES`, the help guide, hosting notes and `.env.example` where relevant).
- Run the light and dark audit (desktop and phone) and the dropdown audit **only when the owner asks**. Each feature's own Playwright check still runs every time.
- Anything with consequences (deleting, refunds, moving classes, sending) asks for confirmation first, in plain words that say what will happen.
- AI features: keep effort to the minimum that does the job, never let them handle money or sensitive data, and keep them inside the user's permissions.

## Working on it

```bash
pnpm install
service postgresql start   # if tests fail with ECONNREFUSED
# Fresh container? Tests need a "studio" user and "studio_test" database:
# su postgres -c "psql -c \"create user studio with password 'studio' superuser;\"" && su postgres -c "createdb -O studio studio_test"
pnpm typecheck
pnpm test                  # 351 API tests at the time of writing
```

- New migration: edit `apps/api/src/db/schema.ts`, then `cd apps/api && npx drizzle-kit generate --name <name>`. To regenerate one that isn't merged yet, delete its SQL file and snapshot and remove its entry from `drizzle/meta/_journal.json` first.
- Plans: what each plan includes is `PLAN_INFO` in `packages/shared/src/features.ts`. A new switchable feature needs a place in each plan's `features`. Our staff change plans in HQ (`apps/api/src/modules/platform/routes.ts`) or with `plan:set`.
- Feature switches: a page for a switchable feature needs its route pattern in `ROUTES` in `apps/api/src/modules/settings/features.ts`, and its menu entry needs `feature` in `NAV_ITEMS`. Background jobs skip switched-off studios with `featureOnSql`.
- Route helpers: `withFlags(app, acknowledge, fn)` (returns 409 `needs_confirmation` until acknowledged), `inTx`, `parse`, `requirePermission(req, perm)`. Public routes set `config: { public: true }`; rate limits go in `config.rateLimit`.
- Notifications use templates in `apps/api/src/modules/notifications/templates.ts` (a template must exist before `notify` can use it).
- Secrets: `encryptSecret` / `decryptSecret` in `apps/api/src/lib/secrets.ts` (key from `SECRETS_KEY`).
- Claude API: one platform key (`ANTHROPIC_API_KEY`), usage tracked per studio as AI credits (answer 1, announcement draft 1, campaign draft 3, AI recap 1). See `apps/api/src/modules/assistant/`.
- HQ (our team's dashboard): `apps/api/src/modules/platform/`. Our staff are `platform_staff` rows (`pnpm --filter @studio/api platform:staff <email> <owner|onboarding|support>`); HQ routes use `config: { public: true }` plus the HQ sign-in hook in `platformRoutes`, and `requirePlatform(req, what)` for roles. Studio client details only through `activeSupportAccess`.
- Moving data: `apps/api/src/modules/migration/` (`parse.ts` reads files, `fields.ts` recognises kinds and columns, `normalize.ts` cleans values strictly, `engine.ts` checks, imports, undoes and samples). Design and accuracy rules: `docs/MIGRATION_AND_HQ.md`. New column names an old system uses go in `FIELDS` in `fields.ts`.
- HQ assistant: `apps/api/src/modules/platform/assistant.ts` (model call in `hqModelFor`, `assistant/model.ts`; tests stub it with `setHqModel`).
- Preview: edit `preview/src/*` or the patches, run `python3 inject.py` in `preview/`, run the checks in `preview/checks/`, then republish the artifact to the same URL.
