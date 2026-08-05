import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createApiClient: vi.fn(),
  getDeveloperById: vi.fn(),
  getExtensionById: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  createApiClient: mocks.createApiClient,
  getDeveloperById: mocks.getDeveloperById,
  getExtensionById: mocks.getExtensionById,
}));

import {
  getDeveloperById,
  getDeveloperByOwner,
  getExtensionForSubmission,
  getExtensionsByOwner,
} from '@/lib/extensions-data';
import type { ApplicationEnv } from '@/lib/runtime';

const env: ApplicationEnv = {
  extensionsApiBaseUrl: 'https://api.example.test',
  authClientId: 'client-id',
  authClientSecret: 'client-secret',
  sessionSecret: 'session-secret',
  assertionSigningSecret: 'assertion-secret',
};

beforeEach(() => {
  mocks.createApiClient.mockReset();
  mocks.getDeveloperById.mockReset();
  mocks.getExtensionById.mockReset();
});

describe('API-backed extension data adapters', () => {
  it('treats a failed detail read as a missing submission resource', async () => {
    mocks.getExtensionById.mockRejectedValue(new Error('API unavailable'));

    await expect(getExtensionForSubmission(env, 'extension-id')).resolves.toBe(
      null,
    );
  });

  it('treats failed public developer reads as missing profiles', async () => {
    mocks.getDeveloperById.mockRejectedValue(new Error('API unavailable'));

    await expect(getDeveloperById(env, 'developer-id')).resolves.toBeNull();
  });

  it('keeps owner pages usable when the API cannot load the profile or list', async () => {
    mocks.createApiClient.mockReturnValue({
      getOwnDeveloper: vi.fn().mockRejectedValue(new Error('API unavailable')),
      listMyExtensions: vi.fn().mockRejectedValue(new Error('API unavailable')),
    });

    await expect(getDeveloperByOwner(env, 'user-subject')).resolves.toBeNull();
    await expect(getExtensionsByOwner(env, 'user-subject')).resolves.toEqual(
      [],
    );
  });

  it('can preserve owner API failures for pages that render an error state', async () => {
    const error = new Error('API unavailable');
    mocks.createApiClient.mockReturnValue({
      getOwnDeveloper: vi.fn().mockRejectedValue(error),
      listMyExtensions: vi.fn().mockRejectedValue(error),
    });

    await expect(
      getDeveloperByOwner(env, 'user-subject', { failSoft: false }),
    ).rejects.toBe(error);
    await expect(
      getExtensionsByOwner(env, 'user-subject', { failSoft: false }),
    ).rejects.toBe(error);
  });
});
