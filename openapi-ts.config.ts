import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/extensions-v2.json',
  output: {
    path: 'src/lib/api/generated/extensions-v2',
    postProcess: ['prettier'],
  },
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
});
