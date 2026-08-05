import type { UserInfo } from './oauth';
import { createApiClient, type AccountUser } from './api/client';
import type { ApplicationEnv } from './runtime';

function identityFrom(info: UserInfo) {
  return {
    name: info.name ?? null,
    email: info.email ?? null,
    email_verified: info.email_verified ?? false,
    picture: info.picture ?? null,
    github_login: info['https://fossbilling.org/claims/github_login'] ?? null,
    github_orgs: info['https://fossbilling.org/claims/github_orgs'] ?? null,
    github_orgs_expires_at:
      info['https://fossbilling.org/claims/github_orgs_expires_at'] ?? null,
  };
}

export async function upsertUser(
  env: ApplicationEnv,
  info: UserInfo,
): Promise<void> {
  await createApiClient(env, info.sub).syncIdentity(identityFrom(info));
}

export async function getUser(
  env: ApplicationEnv,
  userId: string,
): Promise<AccountUser> {
  return createApiClient(env, userId).getUser();
}

export async function deleteUser(
  env: ApplicationEnv,
  userId: string,
): Promise<void> {
  await createApiClient(env, userId).deleteUser();
}

export type UserProfile = {
  display_name: string | null;
};

export async function getUserProfile(
  env: ApplicationEnv,
  userId: string,
): Promise<UserProfile> {
  const user = await getUser(env, userId);
  return { display_name: user.display_name };
}

export async function updateUserProfile(
  env: ApplicationEnv,
  userId: string,
  profile: UserProfile,
): Promise<void> {
  await createApiClient(env, userId).updateUserProfile(profile.display_name);
}
