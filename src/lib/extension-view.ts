import {
  ApiRequestError,
  createApiClient,
  getExtensionByIdentifier,
  type OwnedExtension,
} from './api/client';
import type { Extension } from '@/types';
import type { ApplicationEnv } from './runtime';
import type { SessionUser } from './session';

export type ExtensionView =
  | { kind: 'owner'; owned: OwnedExtension; userId: string }
  | { kind: 'public'; extension: Extension };

// The detail API also gives moderators an owned-shaped record. That shape
// alone does not grant editing: match the extension's developer against the
// caller's active, API-verified own profile. Cookie role flags are navigation
// hints, never an editing permission. Mutation endpoints recheck ownership.
export async function loadExtensionView(
  env: ApplicationEnv,
  id: string,
  user: SessionUser | null,
): Promise<ExtensionView> {
  if (user) {
    const api = createApiClient(env, user.sub);
    try {
      const developer = await api.getOwnDeveloper();
      if (developer) {
        const owned = await api.getMyExtension(id);
        if (owned.developer.id === developer.id)
          return { kind: 'owner', owned, userId: user.sub };
      }
    } catch (error) {
      // Missing/inactive profiles and unrelated extensions get the public
      // projection. Outages remain retryable errors, not lost permissions.
      if (!(
        error instanceof ApiRequestError && [403, 404].includes(error.status)
      ))
        throw error;
    }
  }
  return { kind: 'public', extension: await getExtensionByIdentifier(env, id) };
}
