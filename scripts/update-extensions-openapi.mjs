import { mkdir, writeFile } from 'node:fs/promises';

const sourceUrl =
  process.env.EXTENSIONS_API_OPENAPI_URL ??
  'https://api.fossbilling.net/extensions/v2/openapi.json';

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(
    `Unable to fetch the Extensions v2 OpenAPI document: ${response.status} ${response.statusText}`,
  );
}

const document = await response.json();
const schemas = document?.components?.schemas;
const cursorSchemas = [
  schemas?.ExtensionListResponse?.properties?.pagination?.properties
    ?.next_cursor,
  schemas?.Pagination?.properties?.next_cursor,
];

const isNullableStringSchema = (schema) =>
  Array.isArray(schema?.type) &&
  schema.type.length === 2 &&
  schema.type.includes('string') &&
  schema.type.includes('null') &&
  !Object.hasOwn(schema, 'nullable');

if (!cursorSchemas.every(isNullableStringSchema)) {
  throw new Error(
    'The fetched OpenAPI document must represent nullable cursors as type ["string", "null"].',
  );
}

const listItem = schemas?.ExtensionListItem;
if (
  Object.hasOwn(listItem?.properties ?? {}, 'readme') ||
  Object.hasOwn(listItem?.properties ?? {}, 'releases')
) {
  throw new Error(
    'The fetched OpenAPI document must keep readme and releases out of ExtensionListItem.',
  );
}

await mkdir('openapi', { recursive: true });
await writeFile(
  'openapi/extensions-v2.json',
  `${JSON.stringify(document, null, 2)}\n`,
);

console.log(`Updated openapi/extensions-v2.json from ${sourceUrl}`);
