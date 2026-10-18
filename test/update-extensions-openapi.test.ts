import { mkdir, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

const createPaginationSchema = () => ({
  properties: { next_cursor: { type: ['string', 'null'] } },
});

const createDocument = () => ({
  components: {
    schemas: {
      UnifiedExtensionListResponse: {
        properties: { pagination: { $ref: '#/components/schemas/Pagination' } },
      },
      Pagination: createPaginationSchema(),
      ExtensionListItem: { properties: { id: { type: 'string' } } },
    },
  },
});

async function runUpdate(value: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));
  return import('../scripts/update-extensions-openapi');
}

describe('OpenAPI snapshot update', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv(
      'EXTENSIONS_API_OPENAPI_URL',
      'https://example.test/openapi.json',
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('fetches the configured URL and writes the validated document unchanged', async () => {
    const value = createDocument();
    await runUpdate(value);

    expect(fetch).toHaveBeenCalledWith('https://example.test/openapi.json');
    expect(mkdir).toHaveBeenCalledWith('openapi', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      'openapi/extensions-v2.json',
      `${JSON.stringify(value, null, 2)}\n`,
    );
  });

  it('accepts inline pagination on the fallback list response', async () => {
    const value = createDocument();
    await runUpdate({
      components: {
        schemas: {
          Pagination: value.components.schemas.Pagination,
          ExtensionListItem: value.components.schemas.ExtensionListItem,
          ExtensionListResponse: {
            properties: { pagination: createPaginationSchema() },
          },
        },
      },
    });

    expect(writeFile).toHaveBeenCalledOnce();
  });

  it.each([null, [], { components: { schemas: [] } }])(
    'rejects malformed document %j without writing',
    async (value) => {
      await expect(runUpdate(value)).rejects.toThrow('nullable cursors');
      expect(writeFile).not.toHaveBeenCalled();
    },
  );

  it('rejects legacy nullable cursor schemas without writing', async () => {
    const value = createDocument();
    await expect(
      runUpdate({
        components: {
          schemas: {
            ...value.components.schemas,
            Pagination: {
              properties: { next_cursor: { type: 'string', nullable: true } },
            },
          },
        },
      }),
    ).rejects.toThrow('nullable cursors');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([null, [], { readme: {} }, { releases: {} }])(
    'rejects invalid list item properties %j without writing',
    async (properties) => {
      const value = createDocument();
      await expect(
        runUpdate({
          components: {
            schemas: {
              ...value.components.schemas,
              ExtensionListItem: { properties },
            },
          },
        }),
      ).rejects.toThrow('ExtensionListItem');
      expect(writeFile).not.toHaveBeenCalled();
    },
  );

  it('reports HTTP failures without writing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(
      import('../scripts/update-extensions-openapi'),
    ).rejects.toThrow(
      'Unable to fetch the Extensions v2 OpenAPI document: 503',
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});
