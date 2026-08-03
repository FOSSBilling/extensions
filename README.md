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

Apply pending migrations to your local D1 database — safe to re-run any time, it only
applies whatever hasn't already run against that database (tracked in D1's own
`d1_migrations` table, shared with the [`FOSSBilling/api`](https://github.com/FOSSBilling/api)
repo's migrations against this same database):

```bash
npm run db:migrate:local
```

Start the development server:

```bash
npm run dev
```

The site uses Cloudflare D1 for extension data, so some pages require a populated local D1 database or a Wrangler-powered local environment to fully match production.

Icons and avatars from the known FOSSBilling, GitHub, GitLab, Google, and
Gravatar origins are resized through the `/images/{variant}` route on Cloudflare.
Other valid HTTP(S) image URLs remain direct browser requests, so custom-hosted
images continue to work without turning the route into an arbitrary fetch proxy.
The transformer rejects redirects and responses larger than 2 MiB.
Cloudflare deployments must also allow the listed origins under Images →
Transformations → Sources.

## Authentication

Sign-in is delegated to FOSSBilling's central auth service at
[auth.fossbilling.net](https://auth.fossbilling.net) via OAuth2/OIDC (Authorization
Code + PKCE), implemented under `src/pages/auth/` and `src/lib/`. That service is
identity-only — it never exposes roles or permissions. Extension ownership,
submitter/moderator status, and any other authorization concept live entirely in this
app's own `users` table (`src/lib/db/migrations/`), keyed by the auth service's `sub`
claim, in the same `DB_EXTENSIONS` D1 database this app already reads from.

The client requests the dedicated `github` scope when it needs the linked GitHub
username and organization claims. The issuer omits those claims for tokens without
that scope, and users may need to reauthorize after a scope change.

Sessions are a self-contained, HMAC-signed cookie minted after the initial token
exchange — this app does not depend on the auth service's own token lifetimes beyond
that exchange.

### Extension submission, ownership, and moderation

Signed-in users manage two separate profiles from `/account`:

- **Account profile** (`/account/profile`) — personal `display_name`/`bio`, stored only in
  this app's own `users` table. Written directly to D1 here, not moderated (not yet shown
  publicly).
- **Developer profile** (`/account/developer`) — the publisher identity (`developers` row:
  name, type, URL, bio, avatar, and a private contact email) shown on your extensions in the
  directory and on your public developer page at `/developer/[id]`. Writes take effect
  immediately (`PUT /extensions/v2/developers/me`) — there's no moderation gate on creating or
  editing one. A moderator can mark a profile **approved** as a trust badge
  (`/account/moderate/developers`); it's cosmetic, not a publish gate, and any edit clears
  the badge again until it's re-reviewed. `contact_email` is never read by any public-facing
  query (`getDeveloperById` in `src/lib/database.ts` deliberately omits it) — only
  `getDeveloperByOwner`, used for the owner's own self-management form, selects it.

An extension submission always targets an existing, owned developer profile — the two are
deliberately kept separate (rather than letting extension submission implicitly create/edit
a developer profile).

A profile's owner can hand it to a different account via a **single-use transfer link**
(`/account/developer`, "Transfer ownership") — the link is only ever shown once, expires
after 24 hours, and the recipient must explicitly accept it at `/account/developer/transfer/[token]`
while signed in (`POST /extensions/v2/developers/transfers/{token}/accept`). An account can own at
most one developer profile, so accepting fails with a 409 if the recipient already has one.

Profiles with no owner at all (`owner_user_id IS NULL` — pre-v2 rows, or ones detached by the
api repo's owner-uniqueness migration) show an **Unclaimed** badge on their public page and can
be **claimed**: a signed-in user requests ownership (`POST /extensions/v2/developers/{id}/claim`,
with an optional note), and a moderator approves or rejects the request at
`/account/moderate/developers/claims` — there's no automated verification, so approval is a
judgment call based on the note and the profile itself. This is how legacy, pre-ownership-tracking
profiles get linked to an actual account.

Both flows keep the badge/moderation trust model consistent: accepting a transfer or having a
claim approved clears the `approved` badge, same as any other change to who controls a profile.

The api repo renamed its v2-owned `authors` table (and related schemas/routes) to `developers`
— "author" implied solo/literary authorship, which never fit an entity that can be an
organization, gets moderated, and can be transferred or claimed. `extensions.author_id`, the
FK column on the (v1-owned) `extensions` table itself, was deliberately left unrenamed — only
the table it points to changed — so `src/lib/database.ts`'s queries still select `e.author_id`
but alias it to `developer_id` before it reaches any app code.

Extension submissions (new extensions and edits) are the one thing still moderated: they go
into a queue at `/account/moderate` and only take effect once a moderator approves them — a
higher bar than developer profiles since they carry download URLs and arbitrary readme/website
content. All writes to the shared `developers`/`extensions` tables — moderated or not — happen in
the [`FOSSBilling/api`](https://github.com/FOSSBilling/api) repo's `/extensions/v2` service,
not here; this app never writes to those tables directly. The public catalogue uses the generated
client from `src/lib/api/generated/extensions-v2`, with `GET /extensions` loaded in bounded cursor pages
and `GET /extensions/{id}` used for complete detail pages. Account ownership/editing queries still
use this app's D1 helpers (`getExtensionsByOwner`, `getExtensionForSubmission`,
`getDeveloperByOwner`, and `getDeveloperById`); the public developer page derives its `unclaimed`
flag from `owner_user_id IS NULL` (never exposing the raw owner id itself, which would leak
another user's identifier).

Regenerate the client from the checked-in API contract with:

```bash
npm run api:generate
```

Refresh the reviewed contract snapshot from the upstream API and regenerate it
with `npm run api:update`. `npm run api:check` verifies that the committed
generated files match `openapi/extensions-v2.json`.

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
```

## License

The extension directory website is licensed under the GNU Affero General Public License Version 3. See [LICENSE](./LICENSE) for details.

Individual extensions are licensed by their respective authors.
