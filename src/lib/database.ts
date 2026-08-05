// Domain data is owned by the API Worker. These small adapters keep the
// existing page-facing models stable while routing every read through the
// generated Extensions v2 client.
import {
  ApiRequestError,
  createApiClient,
  getDeveloperById as getDeveloperByIdFromApi,
  getExtensionById as getExtensionByIdFromApi,
  type DeveloperProfile as ApiDeveloperProfile,
  type Extension as ApiExtension,
  type ExtensionListItem as ApiExtensionListItem,
} from './api/client';
import type { PublicDeveloper } from './api/generated/extensions-v2';
import type { ApplicationEnv } from './runtime';
import type {
  DeveloperProfile,
  Extension,
  PublicDeveloperProfile,
} from '@/types';

function isNotFound(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

function toDeveloperProfile(
  developer: ApiDeveloperProfile & { has_pending_transfer?: boolean },
): DeveloperProfile & { has_pending_transfer?: boolean } {
  return {
    id: developer.id,
    type: developer.type,
    name: developer.name,
    URL: developer.URL,
    avatar_url: developer.avatar_url,
    contact_email: developer.contact_email,
    approved: developer.approved,
    content_revision: developer.content_revision,
    github_org_verified: developer.github_org_verified,
    github_verification_note: developer.github_verification_note,
    github_verified_at: developer.github_verified_at,
    github_url_verified: developer.github_url_verified,
    unclaimed: developer.unclaimed,
    ...(developer.has_pending_transfer !== undefined
      ? { has_pending_transfer: developer.has_pending_transfer }
      : {}),
  };
}

function toPublicDeveloper(developer: PublicDeveloper): PublicDeveloperProfile {
  return {
    id: developer.id,
    type: developer.type,
    name: developer.name,
    URL: developer.URL,
    avatar_url: developer.avatar_url,
    approved: developer.approved,
    unclaimed: developer.unclaimed,
  };
}

function toExtension(extension: ApiExtension): Extension {
  return {
    id: extension.id,
    type: extension.type,
    name: extension.name,
    description: extension.description,
    releases: extension.releases,
    website: extension.website,
    license: extension.license,
    icon_url: extension.icon_url,
    readme: extension.readme,
    source: extension.source,
    version: extension.version,
    download_url: extension.download_url,
    developer: toPublicDeveloper(extension.developer),
  };
}

export async function getExtensionForSubmission(
  env: ApplicationEnv,
  id: string,
): Promise<Extension | null> {
  try {
    return toExtension(await getExtensionByIdFromApi(env, id));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function getExtensionsByOwner(
  env: ApplicationEnv,
  userId: string,
): Promise<ApiExtensionListItem[]> {
  const api = createApiClient(env, userId);
  const extensions: ApiExtensionListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listMyExtensions({ limit: 100, cursor });
    extensions.push(...page.result);
    cursor = page.pagination.has_more
      ? (page.pagination.next_cursor ?? undefined)
      : undefined;
  } while (cursor !== undefined);
  return extensions;
}

export async function getDeveloperByOwner(
  env: ApplicationEnv,
  userId: string,
): Promise<(DeveloperProfile & { has_pending_transfer?: boolean }) | null> {
  const developer = await createApiClient(env, userId).getOwnDeveloper();
  return developer ? toDeveloperProfile(developer) : null;
}

export async function getDeveloperById(
  env: ApplicationEnv,
  id: string,
): Promise<PublicDeveloperProfile | null> {
  try {
    return toPublicDeveloper(await getDeveloperByIdFromApi(env, id));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
