import type { ExtensionCatalogueFilters } from '@/lib/api/client';
import { isExtensionType } from '@/types';

// Query parsing shared by the catalogue JSON API (/api/extensions) and the
// load-more fragment (/api/extensions/cards), so the two endpoints always
// accept exactly the same filters.
export function parseCatalogueFilters(params: URLSearchParams):
  | {
      filters: ExtensionCatalogueFilters;
      error: null;
    }
  | {
      filters: null;
      error: string;
    } {
  const filters: ExtensionCatalogueFilters = {};
  const type = params.get('type');
  if (type !== null && type !== '' && !isExtensionType(type)) {
    return { filters: null, error: 'The extension type filter is invalid.' };
  }
  if (type) {
    filters.type = type;
  }
  const developerId = params.get('developer_id');
  if (developerId !== null) {
    filters.developer_id = developerId;
  }
  const limit = params.get('limit');
  if (limit !== null) {
    const parsedLimit = Number(limit);
    if (Number.isFinite(parsedLimit)) {
      filters.limit = parsedLimit;
    }
  }
  if (params.has('cursor')) {
    filters.cursor = params.get('cursor') ?? '';
  }
  return { filters, error: null };
}
