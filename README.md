# FOSSBilling Extensions

The FOSSBilling Extensions site is the official directory for extensions that can be discovered and installed by FOSSBilling users.

Visit the directory at [extensions.fossbilling.org](https://extensions.fossbilling.org).

## About the Directory

The directory helps FOSSBilling users find compatible modules, themes, payment gateways, server managers, domain registrars, hooks, and translations.

Only extensions that can be auto-installed from within FOSSBilling are listed at this time. Other community extensions may still be available through the FOSSBilling documentation, GitHub, or individual maintainers.

## Installing Extensions

The recommended way to install an extension is from your FOSSBilling admin panel:

1. Log in to your FOSSBilling admin panel.
2. Open the Extensions page.
3. Find the extension you want to install.
4. Click Install.

Extensions can also be installed manually by downloading an archive, extracting it into the correct FOSSBilling extension folder, and enabling it from the admin panel.

## Submitting Extensions

Sign in (top-right of the site) and visit [/account](https://extensions.fossbilling.org/account). First-time publishers create a [developer profile](https://extensions.fossbilling.org/account/developer) (publisher name, type, URL) — this takes effect immediately, no approval needed, so you can submit new extensions or edit ones you already publish right away. A moderator can separately mark a profile as approved, shown as a badge; extension submissions themselves still go through moderator review before they appear in (or change) the public directory — see [Authentication](#authentication) below for how ownership and moderation work.

Your personal [account profile](https://extensions.fossbilling.org/account/profile) (display name, bio) is separate from your developer profile — it's not shown publicly yet, but is there ahead of future features like comments and ratings.

## Badges

The FOSSBilling API provides badges that extension authors can use in README files or project pages.

Examples:

```text
https://api.fossbilling.net/extensions/v1/Example/badges/version
https://api.fossbilling.net/extensions/v1/Example/badges/min_fossbilling_version
https://api.fossbilling.net/extensions/v1/Example/badges/license
```

Badge colors can be customized with a `?color=` query parameter.

## Contributing

Issues and pull requests are welcome. Useful contributions include bug reports, accessibility improvements, UI fixes, documentation updates, and improvements to extension metadata handling.

For broader discussion, join the FOSSBilling community on [Discord](https://fossbilling.org/discord).

## Local Development

Install dependencies:

```bash
npm install
```

Create local secrets:

```bash
cp .dev.vars.example .dev.vars
```

`AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET` are issued by an admin of the
[`FOSSBilling/auth`](https://github.com/FOSSBilling/auth) service (dynamic client
registration is disabled there) — request a client with both
`https://extensions.fossbilling.org/auth/callback` and
`http://localhost:4321/auth/callback` as redirect URIs. `SESSION_SECRET` can be any
random string, e.g. `openssl rand -base64 32`.

`ASSERTION_SIGNING_SECRET` must match the
[`FOSSBilling/api`](https://github.com/FOSSBilling/api) repo's own
`ASSERTION_SIGNING_SECRET` exactly — it's a shared secret this app uses to prove a
signed-in user's identity to that repo's `/extensions/v2` submission endpoints (see
[Authentication](#authentication)). By default `/account` calls the production api at
`https://api.fossbilling.net`; set `EXTENSIONS_API_BASE_URL` in `.dev.vars` to point at
a local `api` dev server instead if you're working on that side too.

Apply the `users` table to your local D1 database:

```bash
npm run db:migrate:local
```

If you already had a `users` table from before the `is_moderator` or `display_name`/`bio`
columns existed, also run the one-time migrations (a fresh table created just above already
has them):

```bash
npx wrangler d1 execute DB_EXTENSIONS --local --file=./src/lib/db/migrations/0001_add_is_moderator.sql
npx wrangler d1 execute DB_EXTENSIONS --local --file=./src/lib/db/migrations/0002_add_profile_fields.sql
```

Start the development server:

```bash
npm run dev
```

The site uses Cloudflare D1 for extension data, so some pages require a populated local D1 database or a Wrangler-powered local environment to fully match production.

## Authentication

Sign-in is delegated to FOSSBilling's central auth service at
[auth.fossbilling.net](https://auth.fossbilling.net) via OAuth2/OIDC (Authorization
Code + PKCE), implemented under `src/pages/auth/` and `src/lib/`. That service is
identity-only — it never exposes roles or permissions. Extension ownership,
submitter/moderator status, and any other authorization concept live entirely in this
app's own `users` table (`src/lib/db/users.sql`), keyed by the auth service's `sub`
claim, in the same `DB_EXTENSIONS` D1 database this app already reads from.

Sessions are a self-contained, HMAC-signed cookie minted after the initial token
exchange — this app does not depend on the auth service's own token lifetimes beyond
that exchange.

### Extension submission, ownership, and moderation

Signed-in users manage two separate profiles from `/account`:

- **Account profile** (`/account/profile`) — personal `display_name`/`bio`, stored only in
  this app's own `users` table. Written directly to D1 here, not moderated (not yet shown
  publicly).
- **Developer profile** (`/account/developer`) — the publisher identity (`authors` row:
  name, type, URL) shown on your extensions in the directory. Writes take effect
  immediately (`PUT /extensions/v2/authors/me`) — there's no moderation gate on creating or
  editing one. A moderator can mark a profile **approved** as a trust badge
  (`/account/moderate/developers`); it's cosmetic, not a publish gate, and any edit clears
  the badge again until it's re-reviewed.

An extension submission always targets an existing, owned developer profile — the two are
deliberately kept separate (rather than letting extension submission implicitly create/edit
an author) so that things like reassigning an extension to a different author, or transferring
a developer profile to another account, stay simple additions later instead of needing to be
untangled from the submission form.

Extension submissions (new extensions and edits) are the one thing still moderated: they go
into a queue at `/account/moderate` and only take effect once a moderator approves them — a
higher bar than developer profiles since they carry download URLs and arbitrary readme/website
content. All writes to the shared `authors`/`extensions` tables — moderated or not — happen in
the [`FOSSBilling/api`](https://github.com/FOSSBilling/api) repo's `/extensions/v2` service,
not here; this app never writes to those tables directly. This app's own
`getExtensionsByOwner`/`getExtensionById`/`getAuthorByOwner` (in `src/lib/database.ts`) read
the live tables directly, same as the public listings.

Each request to `/extensions/v2` is authenticated with a short-lived (60s) HMAC-signed
bearer assertion this app mints per-request (`src/lib/assertion.ts`), proving the
signed-in user's identity to the api repo without that repo needing to know anything
about auth.fossbilling.net. See that repo's `src/lib/auth/` for the verification side.

Moderators are flagged via the `is_moderator` column on this repo's `users` table —
there's no UI to grant it; run directly against D1:

```bash
npx wrangler d1 execute DB_EXTENSIONS --remote --command "UPDATE users SET is_moderator = 1 WHERE id = '<sub>'"
```

Production secrets:

```bash
npx wrangler secret put AUTH_CLIENT_ID
npx wrangler secret put AUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ASSERTION_SIGNING_SECRET
```

```bash
npm run db:migrate:remote
npx wrangler d1 execute DB_EXTENSIONS --remote --file=./src/lib/db/migrations/0001_add_is_moderator.sql
npx wrangler d1 execute DB_EXTENSIONS --remote --file=./src/lib/db/migrations/0002_add_profile_fields.sql
```

## License

The extension directory website is licensed under the GNU Affero General Public License Version 3. See [LICENSE](./LICENSE) for details.

Individual extensions are licensed by their respective authors.
