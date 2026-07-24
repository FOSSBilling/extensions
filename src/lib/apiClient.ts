// Server-side-only client for the api repo's v2 submissions endpoints
// (src/services/extensions/v2/). Never import this from client-side code —
// minting a bearer assertion requires ASSERTION_SIGNING_SECRET.
import { mintBearerAssertion } from './assertion';
import type {
  Author,
  AuthorProfile,
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
    upsertAuthorProfile: (author: Author) =>
      call<AuthorProfile>('/authors/me', {
        method: 'PUT',
        body: JSON.stringify(author),
      }),

    listUnapprovedAuthors: () => call<AuthorProfile[]>('/authors/unapproved'),

    approveAuthor: (id: string) =>
      call<{ id: string; approved: true }>(`/authors/${id}/approve`, {
        method: 'POST',
      }),
  };
}
