import type { UserInfo } from './oauth';
import { createApiClient, type AccountUser } from './api/client';
import type { ApplicationEnv } from './runtime';

const GITHUB_ORGS_EXPIRES_AT_CLAIM =
  'https://fossbilling.org/claims/github_orgs_expires_at' as const;
const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function parseRfc3339Timestamp(value: string): number | null {
  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match || match[0] !== value) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  if (day > daysInMonth) return null;

  if (match[7] !== 'Z') {
    const offset = /[+-](\d{2}):(\d{2})/.exec(match[7]);
    if (!offset || Number(offset[1]) > 23 || Number(offset[2]) > 59) {
      return null;
    }
  }

  // Date.parse normalizes invalid components, so only call it after the
  // RFC3339 fields and calendar date have been checked above.
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isFutureGithubOrgsExpiry(
  value: unknown,
  now = Date.now(),
): value is string {
  if (typeof value !== 'string') return false;
  const expiresAt = parseRfc3339Timestamp(value);
  return expiresAt !== null && expiresAt > now;
}

function isGithubOrgList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((org) => typeof org === 'string');
}

function identityFrom(info: UserInfo) {
  const githubOrgs = info['https://fossbilling.org/claims/github_orgs'];
  const githubOrgsExpiresAt = info[GITHUB_ORGS_EXPIRES_AT_CLAIM];
  const hasFreshGithubOrgs =
    isGithubOrgList(githubOrgs) &&
    isFutureGithubOrgsExpiry(githubOrgsExpiresAt);

  return {
    name: info.name ?? null,
    email: info.email ?? null,
    email_verified: info.email_verified ?? false,
    picture: info.picture ?? null,
    github_login: info['https://fossbilling.org/claims/github_login'] ?? null,
    github_orgs: hasFreshGithubOrgs ? githubOrgs : null,
    github_orgs_expires_at: hasFreshGithubOrgs ? githubOrgsExpiresAt : null,
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
