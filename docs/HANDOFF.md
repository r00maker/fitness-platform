# Handoff

Where the project stands, how to work on it, and the owner's rules. Read this first when picking the work up.

## The product

A booking platform for fitness studios in Southeast Asia (in the space of Momence and Mindbody). Studios run classes, appointments, packages and memberships; clients book in an app. The owner's priorities, in order of what to protect:

1. **User-friendliness:** a low skill cap. Things should be easy to find, hard to get wrong, and confirm before anything with consequences.
2. **Plain English:** short, everyday words that travel across the region. No jargon, no idioms. This applies to UI text, errors, emails, docs and PR descriptions.
3. **Security:** studios' data stays separate, roles are enforced on the server, secrets are encrypted, and AI features never see more than they need.

## What's built (all merged to `main`)

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

Details of how each area works, and the decisions behind them, are in `docs/PRODUCT_NOTES.md`. The staff-facing guide (also what the support assistant reads) is `docs/help/STUDIO_GUIDE.md`.

### Code layout

- `apps/api`: Fastify 5, Drizzle ORM, Postgres 16, zod 4, luxon, vitest. Modules under `src/modules/<area>/` (routes, services, tests in `apps/api/test`).
- `packages/shared` (`@studio/shared`): schemas, enums, permissions (`can(role, perm)`), field help text.
- `preview/`: the clickable single-file preview and its source (see `preview/README.md`). Published as a private claude.ai artifact: https://claude.ai/artifact/CevsrLzmfYURdwZtrtmiaW
- `docs/`: product notes, hosting and deployment, security review, help guide, this handoff.

### Not built yet / waiting on something

- **Online payments** (Stripe or similar): no money moves yet. Membership payment holds are wired through `setRenewalCharger` in `apps/api/src/modules/packages/payments.ts` and only switch on once a provider is connected; until then renewals are "pay at the desk".
- **Email inbox going live:** needs a Google OAuth app (Google verification before more than 100 users) and a Microsoft app. Steps in `docs/HOSTING_AND_DEPLOYMENT.md`, section 6.
- **No web or mobile app yet:** the preview stands in for them.
- Suggested next features, roughly in priority order, are listed in `docs/PRODUCT_NOTES.md` ("Suggested next features"): closures and holidays, self check-in, notification preferences, calendar sync, and more.

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
- Before handing over UI work, run the light and dark audit at desktop and phone widths, plus the dropdown audit, and fix what they find.
- Anything with consequences (deleting, refunds, moving classes, sending) asks for confirmation first, in plain words that say what will happen.
- AI features: keep effort to the minimum that does the job, never let them handle money or sensitive data, and keep them inside the user's permissions.

## Working on it

```bash
pnpm install
service postgresql start   # if tests fail with ECONNREFUSED
pnpm typecheck
pnpm test                  # 248 API tests at the time of writing
```

- New migration: edit `apps/api/src/db/schema.ts`, then `cd apps/api && npx drizzle-kit generate --name <name>`. To regenerate one that isn't merged yet, delete its SQL file and snapshot and remove its entry from `drizzle/meta/_journal.json` first.
- Route helpers: `withFlags(app, acknowledge, fn)` (returns 409 `needs_confirmation` until acknowledged), `inTx`, `parse`, `requirePermission(req, perm)`. Public routes set `config: { public: true }`; rate limits go in `config.rateLimit`.
- Notifications use templates in `apps/api/src/modules/notifications/templates.ts` (a template must exist before `notify` can use it).
- Secrets: `encryptSecret` / `decryptSecret` in `apps/api/src/lib/secrets.ts` (key from `SECRETS_KEY`).
- Claude API: one platform key (`ANTHROPIC_API_KEY`), usage tracked per studio as AI credits (answer 1, announcement draft 1, campaign draft 3). See `apps/api/src/modules/assistant/`.
- Preview: edit `preview/src/*` or the patches, run `python3 inject.py` in `preview/`, run the checks in `preview/checks/`, then republish the artifact to the same URL.
