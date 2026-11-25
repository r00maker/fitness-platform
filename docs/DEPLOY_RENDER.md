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

Our addresses are `https://skedoo.io` (the site, also `www.skedoo.io`) and `https://api.skedoo.io` (the API). Render's own addresses still work: `https://studio-site-tkib.onrender.com` and `https://studio-api-td8z.onrender.com`. The plain `studio-api.onrender.com` and `studio-site.onrender.com` belong to another Render account.
- `https://studio-api-td8z.onrender.com/health` shows `{"ok":true}`.
- `https://studio-site-tkib.onrender.com/trial.html` shows the trial page with no "preview" note.

If you ever recreate the services and Render gives them different addresses, change `PUBLIC_API_URL`, `CORS_ORIGINS` and `SITE_API_URL` in `render.yaml` (not in the dashboard: Render re-applies the file on every sync) and merge. Until they match, the site would send sign-ups to whatever server holds the old address.

## In Supabase (once)

Supabase dashboard, project `lezcugmdxretpofadjio`:
1. **Authentication → Emails → SMTP Settings:** add your own email sender, such as Postmark on your domain. Until you do, Supabase sends only a couple of emails an hour and doesn't let you edit the templates.
2. **Authentication → Emails → Templates:** put `{{ .Token }}` in **Magic Link** and in **Confirm signup**, so the email carries the 6-digit code the trial page asks for.
3. **Authentication → URL Configuration:** set the Site URL to the site's address (`https://skedoo.io`).

## The skedoo.io domain

1. **In Render:**
   - **studio-site → Settings → Custom Domains:** add `skedoo.io`. If Render doesn't add `www.skedoo.io` by itself, add that too; Render sends one to the other.
   - **studio-api → Settings → Custom Domains:** add `api.skedoo.io`.
2. **At the domain's DNS:** add the records Render shows next to each domain. They're normally:
   - `skedoo.io`: an ALIAS, ANAME or flattened CNAME to `studio-site-tkib.onrender.com` if your DNS offers one, otherwise the A record Render shows;
   - `www`: a CNAME to `studio-site-tkib.onrender.com`;
   - `api`: a CNAME to `studio-api-td8z.onrender.com`.

   Remove any other A or AAAA record on `skedoo.io` (a registrar's parking page, for example). **Never touch the MX records:** they deliver your email. If the domain has CAA records, they must allow `letsencrypt.org` and `pki.goog`.
3. **Wait for Render** to show each domain as **Verified** with its certificate issued. This is usually minutes, sometimes an hour or two.
4. **Then merge the change** that switches `PUBLIC_API_URL` and `SITE_API_URL` to `https://api.skedoo.io`. If it's merged before the certificate is issued, the trial page can't reach the API. `CORS_ORIGINS` already lists the domain and Render's address, so both work during the switch.
5. **Supabase:** Authentication → URL Configuration → set the Site URL to `https://skedoo.io`.

## Taking the trial live

The trial page is a preview for now (`SITE_TRIAL: preview` on `studio-site` in `render.yaml`): it says so, sends no email and makes no studio. Once email sign-in works (Supabase sending from hello@skedoo.io with the `{{ .Token }}` templates), change it to `live` in `render.yaml` and merge. The site then signs people in with Supabase and starts real trials on `api.skedoo.io`.

## Later

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
