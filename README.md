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

Replace `branding` with your extension ID. The `fossbilling` badge shows the full requirement, such as `>=0.8.9 <1.0 || ^2.0`. Use `?color=green` to change the color. Legacy v1 badge URLs are supported until **5 February 2027** and now display the corresponding v2 badge, including the full version requirement.

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
| `AUTH_CLIENT_ID` / `AUTH_CLIENT_SECRET` | Issued by an admin of [`FOSSBilling/auth`](https://github.com/FOSSBilling/auth). The production client uses `https://extensions.fossbilling.org/auth/callback`; use the development client for localhost and staging (see below). |
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

Branch Previews use HTTP transport to the shared staging API and display synthetic
data. For authenticated testing, one development OAuth client registers
`http://localhost:4321/auth/callback` and
`https://extensions-staging.fossbilling.workers.dev/auth/callback`; branch hostnames
are not registered. The staging directory's assertion-signing and revalidation
secrets must match the API's Previews Base settings.

## License

The extension directory website is licensed under the GNU Affero General Public License Version 3. See [LICENSE](./LICENSE) for details.

Individual extensions are licensed by their respective authors.

## Manifest API contract

The generated v2 client follows the API's manifest v1 contract: `module`, string licenses, optional `homepage_url`, package authors, and full FOSSBilling/PHP/module requirements. Author/edit/moderator forms preserve these fields.

Package preparation is queued. The API returns a private job ID; the release editor shows queued/processing status and saves that reference in browser storage so it can resume after a reload. A completed release joins the local draft and still needs review. Manifest corrections reuse stored source; new submissions and server-side corrections wait for the same job contract with a bounded timeout.

Authors upload ready-to-install distribution ZIPs. Icons use `icon.svg`, `icon.png`, `icon.webp` or `icon.avif` at the package root, without a manifest field. The API prepares display images in the public asset bucket during processing, including pending icons at unlisted UUID URLs. Existing HTTP(S) icon URLs remain supported for display. Package downloads and pending previews use permission-checked API routes.

Published icon URLs use `https://extensions-assets.fossbilling.net/extensions/<extension UUID>/icons/<asset UUID>.<format>`. The extension UUID is independent of its public identifier. SVG or AVIF/PNG variants share the processed icon's immutable asset UUID, so metadata-only edits retain the same icon URL.

API mutations and site mutations purge the `extensions` and `developers` cache tags. The `developers` tag is currently a no-op; developer pages are uncached. Deploy and smoke-test the configured, package-enabled API before deploying this site or enabling the modules publisher. The Queue and Images bindings must exist before the API's automatic deployment, even when package mode is disabled.

## Directory Identity

Extension and developer records use UUIDv7 internal IDs. Public routes, profile handles and publishing requests use the separate `identifier` fields. Keep UUIDs for record identity and audit-history links. A package manifest keeps its `id` field, whose value is the public extension identifier.
