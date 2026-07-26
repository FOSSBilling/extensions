// Server-side-only client for the api repo's v2 submissions endpoints
// (src/services/extensions/v2/). Never import this from client-side code —
// minting a bearer assertion requires ASSERTION_SIGNING_SECRET.
import { mintBearerAssertion } from './assertion';
import type {
  AuthorClaim,
  AuthorHistoryEntry,
  AuthorProfile,
  AuthorProfileInput,
  AuthorTransfer,
  PendingAuthorClaim,
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

    const body = (await response.json()) as
      { result: T } | { error: { code: string; message: string } };

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
    upsertAuthorProfile: (author: AuthorProfileInput) =>
      call<AuthorProfile>('/authors/me', {
        method: 'PUT',
        body: JSON.stringify(author),
      }),

    listUnapprovedAuthors: () => call<AuthorProfile[]>('/authors/unapproved'),

    listAllAuthors: () => call<AuthorProfile[]>('/authors'),

    approveAuthor: (id: string) =>
      call<{ id: string; approved: true }>(`/authors/${id}/approve`, {
        method: 'POST',
      }),

    listAuthorHistory: (id: string) =>
      call<AuthorHistoryEntry[]>(`/authors/${id}/history`),

    // One-time link — the token is only ever returned by this call. Never
    // persisted or put in a URL by the caller.
    initiateTransfer: (id: string) =>
      call<AuthorTransfer>(`/authors/${id}/transfer`, { method: 'POST' }),

    revokeTransfer: (id: string) =>
      call<{ id: string; revoked: true }>(`/authors/${id}/transfer/revoke`, {
        method: 'POST',
      }),

    acceptTransfer: (token: string) =>
      call<AuthorProfile>(`/authors/transfers/${token}/accept`, {
        method: 'POST',
      }),

    claimAuthor: (id: string, note?: string) =>
      call<AuthorClaim>(`/authors/${id}/claim`, {
        method: 'POST',
        body: JSON.stringify(note ? { note } : {}),
      }),

    listMyClaims: () => call<AuthorClaim[]>('/authors/claims/mine'),

    listPendingClaims: () => call<PendingAuthorClaim[]>('/authors/claims'),

    approveClaim: (id: string) =>
      call<AuthorProfile>(`/authors/claims/${id}/approve`, {
        method: 'POST',
      }),

    rejectClaim: (id: string, reviewNote: string) =>
      call<AuthorClaim>(`/authors/claims/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ review_note: reviewNote }),
      }),
  };
}
