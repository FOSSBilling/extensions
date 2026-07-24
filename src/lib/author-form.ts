import type { Author, AuthorProfileInput } from '@/types';

// Builds an AuthorProfileInput from the developer-profile form, for
// PUT /authors/me. The id is immutable once an author exists — see the
// readonly id field in /account/developer.
export function buildAuthorProfile(
  form: FormData,
  existingAuthor: Author | null,
): AuthorProfileInput {
  const str = (name: string) =>
    ((form.get(name) as string | null) ?? '').trim();

  return {
    id: existingAuthor?.id ?? (str('id').toLowerCase() as Lowercase<string>),
    type: (str('type') || 'user') as Author['type'],
    name: str('name'),
    URL: str('url') || undefined,
    bio: str('bio') || undefined,
    avatar_url: str('avatar_url') || undefined,
    contact_email: str('contact_email') || undefined,
  } as AuthorProfileInput;
}
