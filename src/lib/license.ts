import { SPDX_LICENSE_IDS, type License } from '@/types';
import { isSafeHttpUrl } from './safe-url';

export function licenseUrl(license: License | undefined): string | undefined {
  if (!license) return undefined;
  if (isSafeHttpUrl(license.URL)) return license.URL;
  if (license.spdx_id && SPDX_LICENSE_IDS.includes(license.spdx_id)) {
    return `https://spdx.org/licenses/${license.spdx_id}.html`;
  }
  return undefined;
}
