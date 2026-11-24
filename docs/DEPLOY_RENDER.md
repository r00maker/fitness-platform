# Deploying on Render

`render.yaml` (in the repository's root) describes everything Render runs. Render calls this file a Blueprint.

| What | Render name | Plan | Where |
|---|---|---|---|
| The API | `studio-api` | Starter | Singapore |
| The background worker (emails, renewals, waitlists, recurring classes) | `studio-worker` | Starter | Singapore |
| The database (PostgreSQL 16, daily backups) | `studio-db` | Basic 256 MB | Singapore |
| The marketing site, with the free trial page | `studio-site` | Static (free) | Render's CDN |

**Cost:** about US$20 a month (US$7 + US$7 + US$6; the static site is free). Render shows the exact total before you confirm. Every part can be made bigger later from the dashboard without changing the code.

## Before you start

1. **Merge the pull request** with this work into `main`. Render deploys from `main` and redeploys on every merge.
2. **Make a Render account** at render.com: sign up with GitHub. When it asks which repositories it may see, choose `r00maker/fitness-platform`.

## Create it

1. Open https://dashboard.render.com/blueprint/new.
2. Pick `r00maker/fitness-platform` and the `main` branch. Render reads `render.yaml` and lists the four parts above with their costs.
3. It asks for one value, `SITE_SUPABASE_KEY`: paste the Supabase project's **publishable** key (it starts with `sb_publishable_`). Never paste the secret or service-role key; the site's build refuses those.
4. Click **Apply**. The first build takes about 10 minutes. Render builds the API's Docker image, runs the database changes, waits for `/health` to answer, and only then sends traffic to it.

## Check it

- `https://studio-api.onrender.com/health` shows `{"ok":true}`.
- `https://studio-site.onrender.com/trial.html` shows the trial page with no "preview" note.

If Render gave a service a different address (it adds a suffix when a name is taken), update these to the real addresses, then use **Manual Deploy** on the API, the worker and the site:
- `PUBLIC_API_URL` and `CORS_ORIGINS` in the `studio-api-settings` environment group;
- `SITE_API_URL` on `studio-site`.

## In Supabase (once)

Supabase dashboard, project `lezcugmdxretpofadjio`:
1. **Authentication → Emails → SMTP Settings:** add your own email sender, such as Postmark on your domain. Until you do, Supabase sends only a couple of emails an hour and doesn't let you edit the templates.
2. **Authentication → Emails → Templates:** put `{{ .Token }}` in **Magic Link** and in **Confirm signup**, so the email carries the 6-digit code the trial page asks for.
3. **Authentication → URL Configuration:** set the Site URL to the site's address (`https://studio-site.onrender.com`, or your domain later).

## Later

- **Your own domain:** add `api.yourdomain` to `studio-api` and `yourdomain` to `studio-site` (Settings → Custom Domains), then update the three addresses above and the Supabase Site URL.
- **More settings, as each part goes live:** add these to the `studio-api-settings` group as secrets:
  - email (`EMAIL_PROVIDER=postmark`, `POSTMARK_TOKEN`, `EMAIL_FROM`);
  - payments (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`);
  - the assistant (`ANTHROPIC_API_KEY`);
  - `SECRETS_KEY` (64 hex characters, for passwords shared during a data move);
  - `PUBLIC_APP_URL`, once the client web app has an address.

  The full list is in `apps/api/src/config.ts`. The API refuses to start if a production setting is missing or unsafe, and Render keeps the old version running.
- **Growing:** more API copies (Settings → Scaling), a bigger database plan, or a standby database (High Availability). Moving to AWS later uses the same Docker image (see `HOSTING_AND_DEPLOYMENT.md`).

## What was tested before this was written

The build steps aren't run on Render itself from here, so each was repeated on a clean copy of the repository:
- the Dockerfile's install, build and bundle steps;
- the database changes, on an empty database and again on the same database;
- the API in production mode with the Supabase settings: `/health`, the trial terms, the website allowed (and only that one), sign-in tokens checked against the real project's keys, and dev sign-in switched off;
- the worker starting;
- the site's build with the live settings.

The Docker image itself couldn't be built here (image registries are blocked), so Render's first build is the first full image build.
