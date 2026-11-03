# Repository Guidelines

## Project Structure & Module Organization

This repository powers the FOSSBilling extension directory using Astro, TypeScript, Tailwind CSS, and Cloudflare Workers. Extension data comes from the separate FOSSBilling API service; authentication uses OAuth2/OIDC.

- `src/pages/`: file-based pages and HTTP endpoints, including account and moderation routes.
- `src/components/` and `src/layouts/`: reusable Astro UI and page shells.
- `src/lib/`: API access, authentication, caching, forms, and shared utilities.
- `src/scripts/`, `src/styles/`, and `src/assets/`: browser logic, styles, and bundled assets; `public/` contains static files.
- `test/`: Vitest tests and shared fixtures in `test/helpers/`.
- `openapi/` and `scripts/`: API contract and update tooling. Generated clients live in `src/lib/api/generated/extensions-v2/`.

## Build, Test, and Development Commands

Use Node.js 24, matching CI.

- `npm ci`: install dependencies from the committed lockfile.
- `cp .dev.vars.example .dev.vars`: initialize local configuration.
- `npm run dev`: start the local Astro server.
- `npm run check`: run Astro and TypeScript diagnostics.
- `npm test`: run the Vitest suite.
- `npm run format:check`: check Prettier formatting; `npm run format` applies it.
- `npm run build`: create the production build.
- `npm run api:check`: regenerate the API client and verify it matches tracked files.

Run all CI checks before submitting changes. Use `npm run api:update` to refresh the contract and client, or `npm run api:generate` to regenerate from the existing contract. Avoid manual edits to generated clients.

## Coding Style & Naming Conventions

Follow Prettier with its Astro plugin: two-space indentation, single quotes in TypeScript, and semicolons. TypeScript uses Astro's strict configuration. Use `@/` imports for `src/`, PascalCase Astro component names, and kebab-case utility filenames. Follow existing file-based route conventions.

## Testing Guidelines

Tests use Vitest in a Node environment and follow `test/<feature>.test.ts`. Reuse helpers for environment, cookies, and API fixtures. Cover changed behavior and regressions, including failure paths. Run a focused test with `npm test -- test/auth-guard.test.ts`. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent commits use short, imperative descriptions such as `Streamline the extensions README`; no mandatory Conventional Commits prefix appears. Keep commits focused. PRs should explain the problem, resulting behavior, and validation, link relevant issues, and include screenshots for visible UI changes. Target `main` and ensure CI passes.

## Security & Configuration

Keep secrets in local `.dev.vars` or Cloudflare secret bindings. Never commit credentials. Consult `README.md` for authentication setup, shared API secrets, and local transport configuration.
