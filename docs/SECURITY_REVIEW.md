# Security review (November 2026)

A review of the whole API: sign-in and roles, keeping studios apart, every route that doesn't need
sign-in, webhooks, file uploads, emails, exports, stored secrets, the agents and assistant, and
dependencies. Findings and what was done about each.

## Fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | **Unconfirmed email at sign-up.** A new account took whatever email the sign-in token carried. If a provider allowed unconfirmed addresses, someone could sign up with another person's email; a staff invite later sent to that address would attach to their account. | New accounts need the provider's `email_verified` claim. Test: `security.test.ts`. |
| 2 | Medium | **Rate limits could be dodged.** Limits were counted per sign-in token, and limits run before tokens are checked, so made-up tokens gave unlimited attempts on routes that don't need sign-in (e.g. guessing invite links, referral codes). | Counted per address. `TRUST_PROXY_HOPS` makes sure the real address is used behind a load balancer and can't be faked with headers. Test proves the old behaviour failed. |
| 3 | Medium | **Production sign-in didn't require issuer and audience.** Tokens from the same provider meant for a different app could have been accepted. | The API refuses to start in production without `AUTH_ISSUER` and `AUTH_AUDIENCE`. Test added. |
| 4 | Low | **Meta access tokens in web addresses.** Lead look-ups and conversion uploads put the studio's token in the URL, where proxies and logs can record it. | Sent in the `Authorization` header instead. |
| 5 | Low | **Spreadsheet formulas in exports.** The CSV exports neutralised `= + - @` but not a leading tab or carriage return. | Covered too. |
| 6 | Low | **Uploads had only the general limit.** | 30 uploads a minute per address. |
| 7 | Low | **Dependency advisory** (moderate, development only): an old esbuild inside drizzle-kit's tooling. | Pinned to a fixed version; `pnpm audit` is clean. |

## Checked and fine

- **Roles:** every route either checks a permission or calls a service that does (all 229 routes listed and reviewed). Only owners add, promote or remove admins; nobody can change their own role or remove the owner. Removed staff lose access on their next request.
- **Studios kept apart:** every query is filtered by the signed-in studio; records looked up by id are checked to belong to it before they're changed. Agents and the assistant run with the studio fixed by the server, never by input.
- **Public routes:** webhooks check Meta's signature on the raw body (constant-time comparison); Google lead forms and the conversions feed need the studio's secret key; staff invites, unsubscribe and lead links use long random tokens (invites stored only as a hash, single use, 7-day expiry); public files are limited to marketing images.
- **Uploads:** the real type is read from the file's contents (JPEG, PNG, WebP, GIF, PDF only) with size limits; private files are only served to the right people.
- **Emails:** marketing emails are built from blocks, never raw HTML; all text is escaped and links must be web links. Account emails are plain text.
- **SQL:** queries are parameterised; the one raw fragment is a fixed column name.
- **Secrets:** access tokens are encrypted (AES-256-GCM) and never sent back; secrets are compared in constant time; nothing secret is in the repository.
- **Agents and assistant:** see `docs/PRODUCT_NOTES.md`. No tools for money, settings, staff or private client data; actions need a person to confirm and run with their permissions; client-written text is treated as information, not instructions.

## Worth doing before launch

- An independent penetration test.
- PostgreSQL row-level security as a second lock on keeping studios apart.
- Require 2FA for owners and admins in the sign-in provider.
- Staff invite acceptance is marked by the set-password page; once the sign-in provider is chosen, confirm acceptance with the provider's own webhook instead.
