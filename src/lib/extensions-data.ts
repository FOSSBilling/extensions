// Domain data is owned by the API Worker. These small adapters keep the
// existing page-facing models stable while routing every read through the
// generated Extensions v2 client.
import {
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

export interface OwnerReadOptions {
  /**
   * Return the adapter's empty-state value when the API cannot be reached.
   * Account overview pages disable this so they can distinguish an API error
   * from a user who simply has no profile or published extensions.
   */
  failSoft?: boolean;
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
  } catch {
    // These adapters back page reads, not authorization or writes. Preserve
    // their fail-soft contract so a temporary API outage is rendered as a
    // missing resource instead of an unhandled page error.
    return null;
  }
}

export async function getExtensionsByOwner(
  env: ApplicationEnv,
  userId: string,
  options: OwnerReadOptions = {},
): Promise<ApiExtensionListItem[]> {
  try {
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
  } catch (error) {
    if (options.failSoft === false) {
      throw error;
    }

    // Developer-profile and deletion pages use an empty list as their
    // non-fatal "nothing to show" state. Callers that render an explicit
    // error state can disable fail-soft handling through the option above.
    return [];
  }
}

export async function getDeveloperByOwner(
  env: ApplicationEnv,
  userId: string,
  options: OwnerReadOptions = {},
): Promise<(DeveloperProfile & { has_pending_transfer?: boolean }) | null> {
  try {
    const developer = await createApiClient(env, userId).getOwnDeveloper();
    return developer ? toDeveloperProfile(developer) : null;
  } catch (error) {
    if (options.failSoft === false) {
      throw error;
    }

    // Fail-soft callers treat a missing profile and a temporarily unavailable
    // profile as the same empty state; API-backed mutations still enforce
    // ownership. Callers that need to distinguish those states can disable
    // fail-soft handling through the option above.
    return null;
  }
}

export async function getDeveloperById(
  env: ApplicationEnv,
  id: string,
): Promise<PublicDeveloperProfile | null> {
  try {
    return toPublicDeveloper(await getDeveloperByIdFromApi(env, id));
  } catch {
    // Public pages historically treated any domain read failure as a missing
    // profile. Keep that fail-soft behavior at the API adapter boundary.
    return null;
  }
}
