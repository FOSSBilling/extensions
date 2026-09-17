import type {
  ExtensionContent,
  StoredExtensionContent,
} from '@/lib/api/generated/extensions-v2/types.gen';
import {
  DIFF_FIELDS,
  FIELD_LABELS,
  fieldCompareKey,
  fieldDisplay,
  fieldUrl,
  type DiffField,
} from './revision-diff-shared';

export type { DiffField };

export interface RevisionDiffRow {
  field: DiffField;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  // Link targets for values that aren't URLs themselves. The source and
  // license rows carry these (built scheme-agnostically — GitLab/custom
  // sources and license links resolve correctly instead of assuming
  // GitHub). Renderers must still validate the scheme before linking.
  oldUrl: string | null;
  newUrl: string | null;
  changed: boolean;
  isNew: boolean;
}

export function diffRevisionContent(
  published: Partial<ExtensionContent> | null,
  revision: StoredExtensionContent,
): RevisionDiffRow[] {
  const isNew = published === null;
  return DIFF_FIELDS.map((field) => {
    const oldValue = fieldDisplay(field, published);
    const newValue = fieldDisplay(field, revision);
    return {
      field,
      label: FIELD_LABELS[field],
      oldValue,
      newValue,
      oldUrl: fieldUrl(field, published),
      newUrl: fieldUrl(field, revision),
      changed: isNew
        ? newValue !== null
        : fieldCompareKey(field, published) !==
          fieldCompareKey(field, revision),
      isNew,
    };
  });
}

export function countChangedRows(rows: RevisionDiffRow[]): number {
  return rows.filter((r) => r.changed).length;
}
