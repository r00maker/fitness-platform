# Hosting, data storage and shipping updates

## 1. The pieces

```
  Web app (browser)         Mobile app (iOS/Android, React Native)
          \                         /
           \---- HTTPS (TLS) ------/
                     |
            API servers (2+ copies, stateless containers)  ← autoscale behind a load balancer
                     |
   Worker (1+ copies): sends email/push, waitlist timers, tops up recurring classes
                     |
        Managed PostgreSQL (primary + standby, encrypted, backed up)
                     |
 Outside services: sign-in provider · Stripe (payments) · Postmark/SES (email) · Expo → Apple/Google (push)
                   · Meta (WhatsApp, ads) · Claude API (agents, later)
```

Both the API and the worker are the same Docker image (`apps/api/Dockerfile`) started with different commands, so there is one thing to build, scan and deploy.

## 2. Where to host it

**Recommended path: start on a managed platform, keep the option to move to AWS.**

| Stage | API + worker | Database | Web app | Why |
|---|---|---|---|---|
| Pilot (first studios) | Render, Railway or Fly.io containers | Their managed Postgres, or Neon / Supabase | Vercel or Cloudflare Pages | No servers to patch, deploys from GitHub, low monthly cost. |
| Growth | AWS ECS Fargate (or App Runner) | AWS RDS / Aurora PostgreSQL, Multi-AZ | CloudFront + S3, or keep Vercel | Fine-grained network isolation, compliance reports (SOC 2, ISO 27001), regional choice. |

The app only depends on containers and standard PostgreSQL, so moving from stage 1 to stage 2 is a migration of infrastructure, not a rewrite.

**Pick the region where your studios and their clients are**, because data-protection laws (GDPR in the UK/EU, PDPA in Singapore, the Privacy Act in Australia, etc.) can care where personal data is stored. If you expand to another region later, you can run a separate copy of the stack there.

Mobile apps are built and published with **Expo EAS** (React Native) to the App Store and Google Play.

## 3. How information is stored and protected

| What | Where | Protection |
|---|---|---|
| Studios, classes, bookings, waitlists, client names/emails | PostgreSQL | Encrypted at rest (managed DB default) and in transit (TLS). Every row is tagged with its studio (`org_id`) and every query is filtered by the signed-in user's studio. Tests check that one studio can't see another's classes. |
| Passwords, 2FA, social login | **Not stored by us.** A sign-in provider (Clerk, Auth0, AWS Cognito or Supabase Auth) | The API only accepts tokens signed by that provider for this app (`AUTH_JWKS_URL`, `AUTH_ISSUER` and `AUTH_AUDIENCE` are all required in production), then looks up the person's role in *our* database, so a token can't grant itself admin rights. New sign-ups need a confirmed email: set the provider to include `email_verified` in its tokens. |
| Staff invites | Our own invite link → the sign-in provider | The invite email links to the app's “set your password” page, which creates the sign-in with the provider for that email (linked to our user id), then marks the invite accepted. Turn 2FA off for staff in the provider. |
| Card details | **Not stored by us.** Stripe | Cards never touch our servers, which keeps PCI compliance to the lightest level (SAQ-A). |
| Photos, waivers, documents (later) | Private object storage (S3 / Cloudflare R2) | Not publicly readable; the API hands out short-lived signed links. |
| Secrets (DB password, API keys) | The host's secret manager / environment variables | Never in code or git. The app refuses to start if production config is unsafe (e.g. a dev secret is set). |
| Studio access tokens (Meta, ads) | Encrypted in the database with `SECRETS_KEY` | Generate with `openssl rand -hex 32` and keep it in the secret manager. Losing it means studios reconnect their ad accounts; changing it needs a re-encrypt. |
| Claude API key (agents) | The host's secret manager, as `ANTHROPIC_API_KEY` | One key for the whole platform, server side only. Never in the web or mobile app. Separate keys for staging and production. See section 5. |
| Who changed what | `audit_log` table | For support, disputes and data-protection requests. |
| Logs | Host log service (+ Sentry for errors) | Tokens, emails and phone numbers are redacted before logging. |

**Backups:** turn on daily automated backups with **point-in-time recovery** (restore to any minute in the last 7–35 days). Test a restore into staging once a quarter; a backup you've never restored is only a hope.

**Already built:** strict input validation on every request, rate limits per address (set `TRUST_PROXY_HOPS` to the number of load balancers in front of the API, usually 1, so the real address is used), parameterised SQL only (no string-built queries), role checks on every endpoint, row locking for capacity, security headers (Helmet), rate limiting, CORS allow-list, non-root container, dependency vulnerability audit in CI.

**Next hardening steps (before real client data):**
1. PostgreSQL Row-Level Security as a second lock on studio isolation (protects even against a missed filter in code).
2. Require 2FA for owner/admin accounts (a setting in the sign-in provider).
3. Data export and deletion tools for client privacy requests.
4. Field-level encryption for sensitive extras such as health notes or injuries, if you collect them.
5. An independent penetration test before launch.

## 4. Shipping updates and bug fixes

```
 feature branch ──► pull request ──► CI checks ──► review ──► merge to main
                                                              │
                              auto-deploy to STAGING ◄────────┘
                                         │  smoke test (manual or automated)
                              promote to PRODUCTION (one click / approval)
```

1. **All code lives in GitHub.** Every change, including bug fixes, goes through a pull request.
2. **CI runs automatically** (`.github/workflows/ci.yml`): type check, the full test suite against a real database, a production build and a dependency vulnerability audit. Dependabot opens pull requests for security updates. Nothing merges unless CI is green.
3. **Staging** is a full copy of production with fake data. Every merge to `main` deploys there first.
4. **Production deploys are rolling:** new containers start, pass a `/health` check, then take traffic while old ones drain. Users don't see downtime.
5. **Database changes** are migration files in `apps/api/drizzle/`, reviewed in the PR and run automatically as a release step *before* the new code goes live. They're written to be backwards-compatible (add first, remove later), so you can roll back the code at any time.
6. **Rollback** means redeploying the previous image, which takes a minute or two.
7. **Mobile apps:**
   - JavaScript-only fixes (most bugs) ship **over the air** with EAS Update. Users get them next time they open the app, with no app-store review.
   - Changes to native code go through a normal App Store / Play Store release.
   - The API is versioned (`/v1`), so people who haven't updated their app keep working.
8. **Monitoring:** Sentry for errors (web, mobile and API), uptime checks on `/health`, and alerts if the notification outbox backs up or the waitlist timer stops running.

## 5. AI agents: setting up the Claude API

Agents run on the **Claude API**, Anthropic's pay-as-you-go developer platform. You don't need an enterprise plan, and studios never sign up with Anthropic or see a key. The platform has **one account and one bill**, and every studio's agent runs go through it (the same way the platform has one Meta app for every studio's ads).

```
 Studio admin starts an agent run (e.g. "check next week's low bookings")
          │
 Our API: is it allowed? (role, plan allowance, spend caps, kill switch)
          │  one platform key, server side only
 Claude API ──► asks to use one of our tools ("list this studio's sessions")
          │
 Our API runs the tool, limited to that studio's data, and returns the result
          │
 Claude proposes an action ──► the studio's approval inbox ──► a person approves it
```

### One-time setup

1. Create an organisation on the **Claude Console** (platform.claude.com) and add a payment method. You can pay as you go from prepaid credit, and move to invoicing later.
2. Create two **workspaces**, `staging` and `production`. Each gets its own API key and a **monthly spend limit**. The spend limit is a backstop in case the platform's own caps fail.
3. Put each key in that environment's secret manager as `ANTHROPIC_API_KEY`. Never commit it, and never put it in the web or mobile app. Optional settings: `ASSISTANT_MODEL` (default `claude-opus-5-5`), `ASSISTANT_MONTHLY_REPLIES` (replies included per studio each month, default 300) and `ASSISTANT_DISABLED=true` (a kill switch for every studio).
4. Accept Anthropic's **data processing agreement** for the organisation. Add "AI processing (Anthropic)" to the platform's list of subprocessors, and tell studios so their own privacy notices can mention it. This matters under data-protection laws such as PDPA in Singapore, Malaysia and Thailand. By default, data sent through the API under the commercial terms is not used to train models.

### How usage and cost are tracked

- **Anthropic sees one customer, the platform.** Usage per studio is tracked in our own database: every response reports the tokens it used, and each run is recorded against the studio that started it.
- Those records drive the agent allowance in each plan: the 80% warning, the hard stop at 100%, and top-up packs. The platform pays Anthropic and recovers the cost through plan prices and top-ups, the same way WhatsApp message credits work.
- **Each month, check the Console's usage and cost figures against the platform's own records**, so a bug in our counting can't quietly cost money.

### Keeping studios apart

Claude only sees what our tools return. Every tool runs with the requesting studio's `org_id` and the same role checks as the normal API, so one studio's run can't read another studio's data. Agents can **suggest** changes, but a person approves each one in the approval inbox. Agents never get delete or payment tools. Messages from clients are passed to Claude as data, never as instructions.

### Limits and growth

- **Rate limits** start modest and rise automatically as the account's spend grows. With many studios, contact Anthropic's sales team for higher limits and committed-spend pricing. That contract is on the same API, so no code changes. (The "Claude for Enterprise" chat app for staff is a separate product and isn't needed here.)
- **Other routes:** Claude is also available through **AWS Bedrock** and **Google Cloud Vertex AI**. If the platform moves to AWS (stage 2 above), billing can go through the AWS account instead, with the same design. Check that your chosen region offers the models you use.
- **Bring your own key (optional, later):** a very large studio could connect its own Anthropic key. It would be stored encrypted with `SECRETS_KEY`, like the WhatsApp token, and its runs would bypass the plan allowance.

### Keeping costs down

- **Model choice per task.** Claude Opus 5.5 costs US$4 per million input tokens and US$20 per million output tokens. Claude Haiku 5.5 costs US$0.10 and US$0.50, and may be enough for simple sorting such as WhatsApp triage. Check prices on Anthropic's pricing page before setting plan allowances.
- **Prompt caching:** the fixed instructions sent with every run cost about a tenth of the normal price after the first time.
- **Batch runs:** checks that don't need an instant answer (e.g. overnight reports) cost half price through the batch API.
- **Run on a schedule or an event**, not constantly, and keep answers short.

### What's built

- **Reminder agents** (`apps/api/src/modules/agents/`) don't use the Claude API at all: they're rules over the studio's schedule, so they cost nothing per run and don't count towards the allowance. The worker runs them every minute.
- **The assistant** (`apps/api/src/modules/assistant/`) uses the Claude API with tool use. It reads the help guide (`docs/help/` and `docs/PRODUCT_NOTES.md`, copied into the image) and has six tools, all limited to the asker's studio and role. It only *offers* actions; the person confirms each one. If the model declines a request, the API retries on its default fallback model (server-side fallback).
