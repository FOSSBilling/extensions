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

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const schemaProperties = (schema: unknown) =>
  asObject(asObject(schema)?.properties);

const document: unknown = await response.json();
const components = asObject(asObject(document)?.components);
const schemas = asObject(components?.schemas);

const resolveSchema = (value: unknown): Record<string, unknown> | undefined => {
  const schema = asObject(value);
  const ref = schema?.$ref;
  if (typeof ref !== 'string') return schema;
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) return schema;
  return asObject(schemas?.[ref.slice(prefix.length)]);
};

const paginationSchema =
  resolveSchema(
    schemaProperties(schemas?.UnifiedExtensionListResponse)?.pagination,
  ) ??
  resolveSchema(schemaProperties(schemas?.ExtensionListResponse)?.pagination);
const cursorSchemas = [
  schemaProperties(paginationSchema)?.next_cursor,
  schemaProperties(schemas?.Pagination)?.next_cursor,
];

const isNullableStringSchema = (value: unknown): boolean => {
  const schema = asObject(value);
  return (
    Array.isArray(schema?.type) &&
    schema.type.length === 2 &&
    schema.type.includes('string') &&
    schema.type.includes('null') &&
    !Object.hasOwn(schema, 'nullable')
  );
};

if (!cursorSchemas.every(isNullableStringSchema)) {
  throw new Error(
    'The fetched OpenAPI document must represent nullable cursors as type ["string", "null"].',
  );
}

const listItemProperties = schemaProperties(schemas?.ExtensionListItem);
if (!listItemProperties) {
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
