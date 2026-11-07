import { isPackageIconPath } from './package-icon';

/** Resolve manifest paths from supported GitHub release assets; retain legacy URLs. */
export function extensionIconUrl(extension: {
  identifier: string;
  icon_url?: string;
  download_url?: string | null;
  source: { type: string; repo: string };
}): string | undefined {
  const icon = extension.icon_url;
  if (!icon || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(icon))
    return undefined;
  try {
    const absolute = new URL(icon);
    return /^https?:$/.test(absolute.protocol) &&
      !absolute.username &&
      !absolute.password
      ? absolute.href
      : undefined;
  } catch {
    // Manifest icons are package-relative; do not resolve them against the site.
  }
  if (!isPackageIconPath(icon)) return undefined;
  if (
    extension.source.type !== 'github' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(extension.source.repo)
  )
    return undefined;
  try {
    const download = new URL(extension.download_url ?? '');
    if (
      download.origin !== 'https://github.com' ||
      download.username ||
      download.password
    )
      return undefined;
    const [owner, repo] = extension.source.repo.split('/');
    const parts = download.pathname.split('/').slice(1);
    if (
      parts[0].toLowerCase() !== owner.toLowerCase() ||
      parts[1].toLowerCase() !== repo.toLowerCase() ||
      parts[2] !== 'releases' ||
      parts[3] !== 'download' ||
      parts.length !== 6
    )
      return undefined;
    const ref = decodeURIComponent(parts[4]);
    // GitHub refs that look like paths need a separate explicit API contract.
    if (!ref || ref === '.' || ref === '..' || /[/\\]/.test(ref))
      return undefined;
    const packageRoot =
      extension.source.repo.toLowerCase() === 'fossbilling/modules'
        ? extension.identifier.charAt(0).toUpperCase() +
          extension.identifier.slice(1)
        : '';
    const path = [packageRoot, ...icon.split('/')]
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path}`;
  } catch {
    return undefined;
  }
}
