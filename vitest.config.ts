import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Agent worktrees under .claude/ are full checkouts whose test files
    // must never run as part of this repo's suite.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
});
