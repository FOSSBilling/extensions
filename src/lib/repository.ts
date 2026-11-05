import type { Repository } from '@/types';

// Form inputs use one URL; the API retains its existing typed repository
// representation. Match real public hostnames rather than lookalike suffixes.
export function parseRepositoryUrl(value: string): Repository | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  const custom = (): Repository | null =>
    url.href.length <= 500 ? { type: 'custom', repo: url.href } : null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!url.port && (host === 'github.com' || host === 'gitlab.com')) {
    let parts: string[];
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return null;
    }
    if (
      parts.length < 2 ||
      (host === 'github.com' && parts.length !== 2) ||
      parts.includes('-')
    )
      return custom();
    parts[parts.length - 1] = parts[parts.length - 1].replace(/\.git$/i, '');
    if (
      parts.some(
        (part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..',
      )
    )
      return custom();
    if (parts.join('/').length > 500) return null;
    return {
      type: host === 'github.com' ? 'github' : 'gitlab',
      repo: parts.join('/'),
    };
  }
  return custom();
}

export function repositoryInputUrl(fields: Record<string, unknown>): string {
  return typeof fields.source_url === 'string' ? fields.source_url : '';
}

export function repositoryFromFields(
  fields: Record<string, unknown>,
): Repository | null {
  return parseRepositoryUrl(repositoryInputUrl(fields));
}
