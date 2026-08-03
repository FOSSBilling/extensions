import type { Developer } from '@/types';
import type { DeveloperProfileInput } from '@/lib/api/client';
import { isDeveloperType } from '@/types';
import { formString } from './form';
import { withHttpsScheme } from './url-prefix';

// Thrown for form-level validation failures that should be shown to the
// user, distinct from ApiRequestError (the api rejecting an otherwise
// well-formed payload) — see the try/catch in account/developer/index.astro.
export class DeveloperValidationError extends Error {}

// Builds a DeveloperProfileInput from the developer-profile form, for
// PUT /developers/me. The id is immutable once a developer profile exists —
// see the readonly id field in /account/developer.
export function buildDeveloperProfile(
  form: FormData,
  existingDeveloper: Developer | null,
): DeveloperProfileInput {
  const str = (name: string) => formString(form, name);
  const typeInput = str('type');
  const id = existingDeveloper?.id ?? str('id').toLowerCase();
  if (!id) {
    throw new DeveloperValidationError('Publisher ID is required.');
  }

  return {
    id,
    type: isDeveloperType(typeInput) ? typeInput : 'user',
    name: str('name'),
    URL: withHttpsScheme(str('url')),
    avatar_url: withHttpsScheme(str('avatar_url')),
    contact_email: str('contact_email') || undefined,
  };
}
