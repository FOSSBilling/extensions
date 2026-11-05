import { SPDX_LICENSE_IDS } from '@/types';
import { isSafeHttpUrl } from './safe-url';
import type { StoredExtensionFields } from './extensions-data';

export function licenseUrl(
  license: StoredExtensionFields['license'],
): string | undefined {
  if (!license) return undefined;
  if (typeof license !== 'string' && isSafeHttpUrl(license.URL))
    return license.URL;
  const id = typeof license === 'string' ? license : license.spdx_id;
  return id && SPDX_LICENSE_IDS.includes(id)
    ? `https://spdx.org/licenses/${id}.html`
    : undefined;
}
