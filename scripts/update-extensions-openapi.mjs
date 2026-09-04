import { mkdir, writeFile } from 'node:fs/promises';

const sourceUrl =
  process.env.EXTENSIONS_API_OPENAPI_URL ??
  'https://api.fossbilling.net/extensions/v2/docs/openapi.json';

const response = await fetch(sourceUrl);
if (!response.ok) {
  throw new Error(
    `Unable to fetch the Extensions v2 OpenAPI document: ${response.status} ${response.statusText}`,
  );
}

const document = await response.json();
const schemas = document?.components?.schemas;

const resolveSchema = (schema) => {
  const ref = schema?.$ref;
  if (typeof ref !== 'string') return schema;
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) return schema;
  return schemas?.[ref.slice(prefix.length)];
};

const paginationSchema = resolveSchema(
  schemas?.ExtensionListResponse?.properties?.pagination,
);
const cursorSchemas = [
  paginationSchema?.properties?.next_cursor,
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
const listItemProperties = listItem?.properties;
if (
  !listItem ||
  typeof listItem !== 'object' ||
  !listItemProperties ||
  typeof listItemProperties !== 'object' ||
  Array.isArray(listItemProperties)
) {
  throw new Error(
    'The fetched OpenAPI document must define ExtensionListItem with a properties object.',
  );
}

if (
  Object.hasOwn(listItemProperties, 'readme') ||
  Object.hasOwn(listItemProperties, 'releases')
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
