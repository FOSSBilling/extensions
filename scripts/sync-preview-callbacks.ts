import { pathToFileURL } from 'node:url';

type Preview = { name: string; urls: string[] };
type Page<T> = { result: T[]; result_info?: { total_count?: number } };

async function readJson<T>(
  fetcher: typeof fetch,
  url: string,
  token: string,
): Promise<T> {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Metadata request failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function syncPreviewCallbacks(
  options: {
    githubToken: string;
    cloudflareToken: string;
    cloudflareAccount: string;
    oidcRequestUrl: string;
    oidcRequestToken: string;
  },
  fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
) {
  const branches = new Set<string>();
  for (let page = 1; ; page++) {
    const rows = await readJson<Array<{ name: string }>>(
      fetcher,
      `https://api.github.com/repos/FOSSBilling/extensions/branches?per_page=100&page=${page}`,
      options.githubToken,
    );
    rows.forEach((row) => branches.add(row.name));
    if (rows.length < 100) break;
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${options.cloudflareAccount}`;
  const service = await readJson<{
    result: { default_environment: { script: { tag: string } } };
  }>(fetcher, `${base}/workers/services/extensions`, options.cloudflareToken);
  const previews: Preview[] = [];
  for (let page = 1; ; page++) {
    const data = await readJson<Page<Preview>>(
      fetcher,
      `${base}/workers/workers/${service.result.default_environment.script.tag}/previews?per_page=100&page=${page}`,
      options.cloudflareToken,
    );
    previews.push(...data.result);
    if (
      data.result.length < 100 ||
      previews.length >= (data.result_info?.total_count ?? Infinity)
    )
      break;
  }
  const callbacks = [
    ...new Set(
      previews
        .filter(
          (preview) => preview.name !== 'main' && branches.has(preview.name),
        )
        .flatMap((preview) => preview.urls)
        .map((origin) => new URL('/auth/callback', origin).href),
    ),
  ].sort();
  const endpoint =
    'https://auth.fossbilling.net/integrations/extensions-preview-callbacks';
  const oidcUrl = new URL(options.oidcRequestUrl);
  oidcUrl.searchParams.set('audience', endpoint);
  const { value } = await readJson<{ value: string }>(
    fetcher,
    oidcUrl.href,
    options.oidcRequestToken,
  );
  const response = await fetcher(endpoint, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${value}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(callbacks),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 204)
    throw new Error(`Callback registration failed: HTTP ${response.status}`);
  return callbacks.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  }
  const count = await syncPreviewCallbacks({
    githubToken: required('GITHUB_TOKEN'),
    cloudflareToken: required('CLOUDFLARE_PREVIEW_READ_TOKEN'),
    cloudflareAccount: required('CLOUDFLARE_ACCOUNT_ID'),
    oidcRequestUrl: required('ACTIONS_ID_TOKEN_REQUEST_URL'),
    oidcRequestToken: required('ACTIONS_ID_TOKEN_REQUEST_TOKEN'),
  });
  console.log(`Registered ${count} active branch Preview callbacks.`);
}
