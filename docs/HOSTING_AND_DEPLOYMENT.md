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
| Passwords, 2FA, social login | **Not stored by us.** A sign-in provider (Clerk, Auth0, AWS Cognito or Supabase Auth) | The API only accepts tokens signed by that provider, then looks up the person's role in *our* database, so a token can't grant itself admin rights. |
| Card details | **Not stored by us.** Stripe | Cards never touch our servers, which keeps PCI compliance to the lightest level (SAQ-A). |
| Photos, waivers, documents (later) | Private object storage (S3 / Cloudflare R2) | Not publicly readable; the API hands out short-lived signed links. |
| Secrets (DB password, API keys) | The host's secret manager / environment variables | Never in code or git. The app refuses to start if production config is unsafe (e.g. a dev secret is set). |
| Who changed what | `audit_log` table | For support, disputes and data-protection requests. |
| Logs | Host log service (+ Sentry for errors) | Tokens, emails and phone numbers are redacted before logging. |

**Backups:** turn on daily automated backups with **point-in-time recovery** (restore to any minute in the last 7–35 days). Test a restore into staging once a quarter; a backup you've never restored is only a hope.

**Already built:** strict input validation on every request, parameterised SQL only (no string-built queries), role checks on every endpoint, row locking for capacity, security headers (Helmet), rate limiting, CORS allow-list, non-root container, dependency vulnerability audit in CI.

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
