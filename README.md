# FOSSBilling Extensions

The official extension directory for FOSSBilling.

Visit it at [extensions.fossbilling.org](https://extensions.fossbilling.org).

## About the Directory

Lists modules, themes, payment gateways, server managers, domain registrars, hooks, and translations that can be auto-installed from within FOSSBilling.

Only auto-installable extensions are listed. Other community extensions may be available via the FOSSBilling docs, GitHub, or individual maintainers.

## Installing Extensions

From your FOSSBilling admin panel:

1. Log in to the admin panel.
2. Open the Extensions page.
3. Find the extension and click Install.

Manual install is also possible: download the archive, extract it into the correct FOSSBilling extension folder, and enable it from the admin panel.

## Submitting Extensions

Sign in (top-right of the site) and open [/account](https://extensions.fossbilling.org/account). First-time publishers create a [developer profile](https://extensions.fossbilling.org/account/developer), then submit new extensions or edit ones they publish. Submissions go through moderator review before they appear in the directory.

Your [account profile](https://extensions.fossbilling.org/account/profile) (display name, bio) is separate from your developer profile and is not shown publicly yet.

## Badges

The [`FOSSBilling/api`](https://github.com/FOSSBilling/api) repo serves badges for use in READMEs and project pages:

```text
https://api.fossbilling.net/extensions/v2/extensions/branding/badges/version
https://api.fossbilling.net/extensions/v2/extensions/branding/badges/fossbilling
https://api.fossbilling.net/extensions/v2/extensions/branding/badges/license
```

The `fossbilling` badge displays the latest release's complete version requirement, including upper bounds, exclusions, and compound ranges. Replace `branding` with your extension ID. Colors can be customized with `?color=green`. Existing v1 badge URLs remain available for older embeds, but their minimum-version badge does not express the full compatibility range.

## Contributing

Issues and pull requests are welcome. Useful contributions include bug reports, accessibility improvements, UI fixes, documentation updates, and improvements to extension metadata handling.

For broader discussion, join the FOSSBilling community on [Discord](https://fossbilling.org/discord).

## Local Development

Astro site on Cloudflare Workers. Extension data comes from the [`FOSSBilling/api`](https://github.com/FOSSBilling/api) repo's `/extensions/v2` service via the generated client in `src/lib/api/generated/extensions-v2`. Sign-in is delegated to `auth.fossbilling.net` via OAuth2/OIDC.

Install dependencies:

```bash
npm install
```

Set up local secrets:

```bash
cp .dev.vars.example .dev.vars
```

| Variable | Notes |
| --- | --- |
| `AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET` | Issued by an admin of [`FOSSBilling/auth`](https://github.com/FOSSBilling/auth). Request `https://extensions.fossbilling.org/auth/callback` and `http://localhost:4321/auth/callback` as redirect URIs. |
| `SESSION_SECRET` | Any random string, e.g. `openssl rand -base64 32`. |
| `ASSERTION_SIGNING_SECRET` | Must match the `api` repo's value exactly. |
| `EXTENSIONS_REVALIDATE_SECRET` | Shared with the `api` repo for `POST /api/revalidate`. |
| `EXTENSIONS_API_BASE_URL` | Defaults to `https://api.fossbilling.net`. Point at a local `api` dev server when working on both. |
| `EXTENSIONS_API_TRANSPORT` | `http` locally, `binding` in production. |

Start the dev server:

```bash
npm run dev
```

Run the checks before pushing. CI runs the same suite on pushes to `main` and pull requests targeting `main`:

```bash
npm run api:check    # generated client matches openapi/extensions-v2.json
npm run format:check # prettier
npm test             # vitest suite
npm run check        # astro check
npm run build        # production build
```

Refresh the API contract and client with `npm run api:update` (also run weekly by the `Update Extensions v2 OpenAPI` workflow). To regenerate the client from the existing contract only, run `npm run api:generate`.

Production secrets:

```bash
npx wrangler secret put AUTH_CLIENT_ID
npx wrangler secret put AUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ASSERTION_SIGNING_SECRET
npx wrangler secret put EXTENSIONS_REVALIDATE_SECRET
```

## License

The extension directory website is licensed under the GNU Affero General Public License Version 3. See [LICENSE](./LICENSE) for details.

Individual extensions are licensed by their respective authors.

## Manifest API contract

The generated v2 client follows the API's manifest v1 contract: `module`, string licenses, optional `homepage_url`, package authors, and full FOSSBilling/PHP/module requirements. Author/edit/moderator forms preserve these fields; historical revision diffs also accept pre-manifest license objects and `website` fields.

Package icons are paths relative to the distribution root. For GitHub release assets matching the declared source repository, the site resolves them against the release tag. `FOSSBilling/modules` uses its `Ucfirst(id)/` package directory; other GitHub sources use the repository root. Unsupported sources omit relative icons. Legacy HTTP(S) icons continue to work.

API mutations and site mutations both purge the `extensions` and `developers` tags. The `developers` tag is currently a no-op reserved for future cached surfaces; developer pages are uncached. Deploy this site with the API's manifest migration and cache-tag change before enabling the updated modules publisher. Existing cached pages expire through their cache windows; deployment must coordinate the new contract and tag. Old pending revisions require resubmission using the manifest fields before approval.
