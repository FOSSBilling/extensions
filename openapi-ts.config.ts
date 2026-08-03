import { defineConfig } from '@hey-api/openapi-ts';

const openApiUrl =
  process.env.EXTENSIONS_API_OPENAPI_URL ??
  'https://api.fossbilling.net/extensions/v2/openapi.json';

function normalizeLegacyNullable(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(normalizeLegacyNullable);
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  const record = value as { [key: string]: unknown };
  if (record.nullable === true && typeof record.type === 'string') {
    record.type = [record.type, 'null'];
    delete record.nullable;
  }

  Object.values(record).forEach(normalizeLegacyNullable);
}

export default defineConfig({
  input: openApiUrl,
  output: {
    path: 'src/generated/extensions-v2',
    postProcess: ['prettier'],
  },
  plugins: ['@hey-api/typescript', '@hey-api/sdk', '@hey-api/client-fetch'],
  parser: {
    patch: {
      input: normalizeLegacyNullable,
    },
  },
});
