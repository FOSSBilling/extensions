import { isSafeHttpUrl } from './safe-url';

// Only these exact same-origin paths bypass HTTP URL checks in review links.
const artifactIdPattern =
  '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const idPattern = new RegExp(`^${artifactIdPattern}$`, 'i');
const pathPattern = new RegExp(`^/package/${artifactIdPattern}$`, 'i');
export function packageDownloadPath(id: unknown): string | null {
  return typeof id === 'string' && idPattern.test(id) ? `/package/${id}` : null;
}
export function isPackageDownloadPath(value: string): boolean {
  return pathPattern.test(value);
}

export function isSafeDiffHref(
  value: string | null | undefined,
): value is string {
  return Boolean(
    value && (isSafeHttpUrl(value) || isPackageDownloadPath(value)),
  );
}
