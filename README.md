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

Extension submission is currently paused while self-service submission and management are being prepared.

If you maintain an extension and would like it to be listed, please open an issue in this repository with a link to the extension and any relevant installation details.

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

Apply the `users` table to your local D1 database:

```bash
npm run db:migrate:local
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

Production secrets:

```bash
npx wrangler secret put AUTH_CLIENT_ID
npx wrangler secret put AUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

```bash
npm run db:migrate:remote
```

## License

The extension directory website is licensed under the GNU Affero General Public License Version 3. See [LICENSE](./LICENSE) for details.

Individual extensions are licensed by their respective authors.
