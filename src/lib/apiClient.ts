// Server-side-only client for the api repo's v2 submissions endpoints
// (src/services/extensions/v2/). Never import this from client-side code —
// minting a bearer assertion requires ASSERTION_SIGNING_SECRET.
import { mintBearerAssertion } from './assertion';
import type {
  DeveloperClaim,
  DeveloperHistoryEntry,
  DeveloperProfile,
  DeveloperProfileInput,
  DeveloperTransfer,
  PendingDeveloperClaim,
  Submission,
  SubmissionPayload,
  SubmissionStatus,
} from '@/types';

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createApiClient(env: Cloudflare.Env, sub: string) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await mintBearerAssertion(sub, env.ASSERTION_SIGNING_SECRET);
    const response = await fetch(
      `${env.EXTENSIONS_API_BASE_URL}/extensions/v2${path}`,
      {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    let body: { result: T } | { error: { code: string; message: string } };
    try {
      body = await response.json();
    } catch {
      throw new ApiRequestError(
        response.status,
        'invalid_response',
        'The extensions API returned an unexpected response.',
      );
    }

    if (!response.ok) {
      const { error } = body as { error: { code: string; message: string } };
      throw new ApiRequestError(response.status, error.code, error.message);
    }

    return (body as { result: T }).result;
  }

  return {
    submitExtension: (payload: SubmissionPayload) =>
      call<{ id: string; status: 'pending' }>('/submissions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    listMySubmissions: () => call<Submission[]>('/submissions/mine'),

    listQueue: (status: SubmissionStatus = 'pending') =>
      call<Submission[]>(`/submissions/queue?status=${status}`),

    approveSubmission: (id: string, reviewNote?: string) =>
      call<{ id: string; status: 'approved' }>(`/submissions/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(reviewNote ? { review_note: reviewNote } : {}),
      }),

    rejectSubmission: (id: string, reviewNote: string) =>
      call<{ id: string; status: 'rejected' }>(`/submissions/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ review_note: reviewNote }),
      }),

    // Direct write, not moderated — takes effect immediately. `approved` in
    // the response is a moderator-set trust badge, not a publish gate.
    upsertDeveloperProfile: (developer: DeveloperProfileInput) =>
      call<DeveloperProfile>('/developers/me', {
        method: 'PUT',
        body: JSON.stringify(developer),
      }),

    // 409s (developer_has_extensions / developer_has_pending_submissions) if
    // the profile can't be deleted yet — callers should surface the message.
    deleteDeveloperProfile: () =>
      call<{ id: string; deleted: true }>('/developers/me', {
        method: 'DELETE',
      }),

    listUnapprovedDevelopers: () =>
      call<DeveloperProfile[]>('/developers/unapproved'),

    listAllDevelopers: () => call<DeveloperProfile[]>('/developers'),

    // expectedRevision must match the profile's current content_revision —
    // the api rejects the approval with 409 if the profile changed since it
    // was reviewed.
    approveDeveloper: (id: string, expectedRevision: number) =>
      call<{ id: string; approved: true }>(`/developers/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ expected_revision: expectedRevision }),
      }),

    listDeveloperHistory: (id: string) =>
      call<DeveloperHistoryEntry[]>(`/developers/${id}/history`),

    // One-time link — the token is only ever returned by this call. Never
    // persisted or put in a URL by the caller.
    initiateTransfer: (id: string) =>
      call<DeveloperTransfer>(`/developers/${id}/transfer`, {
        method: 'POST',
      }),

    revokeTransfer: (id: string) =>
      call<{ id: string; revoked: true }>(`/developers/${id}/transfer/revoke`, {
        method: 'POST',
      }),

    acceptTransfer: (token: string) =>
      call<DeveloperProfile>('/developers/transfers/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    claimDeveloper: (id: string, note?: string) =>
      call<DeveloperClaim>(`/developers/${id}/claim`, {
        method: 'POST',
        body: JSON.stringify(note ? { note } : {}),
      }),

    listMyClaims: () => call<DeveloperClaim[]>('/developers/claims/mine'),

    listPendingClaims: () =>
      call<PendingDeveloperClaim[]>('/developers/claims'),

    approveClaim: (id: string) =>
      call<DeveloperProfile>(`/developers/claims/${id}/approve`, {
        method: 'POST',
      }),

    rejectClaim: (id: string, reviewNote: string) =>
      call<DeveloperClaim>(`/developers/claims/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ review_note: reviewNote }),
      }),
  };
}

// Claim status is a nice-to-have on the account pages, not essential — a
// failure here shouldn't break the page, so callers get an empty list back
// instead of having to duplicate this fallback themselves.
export async function listMyClaimsSafely(
  api: ReturnType<typeof createApiClient>,
): Promise<DeveloperClaim[]> {
  try {
    return await api.listMyClaims();
  } catch {
    return [];
  }
}
