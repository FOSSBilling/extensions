import type { Developer, DeveloperProfileInput } from '@/types';

// Builds a DeveloperProfileInput from the developer-profile form, for
// PUT /developers/me. The id is immutable once a developer profile exists —
// see the readonly id field in /account/developer.
export function buildDeveloperProfile(
  form: FormData,
  existingDeveloper: Developer | null,
): DeveloperProfileInput {
  const str = (name: string) =>
    ((form.get(name) as string | null) ?? '').trim();

  return {
    id: existingDeveloper?.id ?? (str('id').toLowerCase() as Lowercase<string>),
    type: (str('type') || 'user') as Developer['type'],
    name: str('name'),
    URL: str('url') || undefined,
    bio: str('bio') || undefined,
    avatar_url: str('avatar_url') || undefined,
    contact_email: str('contact_email') || undefined,
  } as DeveloperProfileInput;
}
