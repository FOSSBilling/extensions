import type { createApiClient } from './api/client';
import { ApiRequestError } from './api/client';
import {
  applyExtensionDraft,
  editableContent,
  reconstructionContent,
} from './extension-draft';
import { sha256Hex } from './hash';

export async function prepareExtensionDraft(
  api: Pick<
    ReturnType<typeof createApiClient>,
    'getMyExtension' | 'getRevision'
  >,
  id: string,
  draft: unknown,
) {
  const value = draft as {
    pendingRevisionId?: string;
    baselineHash?: string;
  } | null;
  const owned = await api.getMyExtension(id);
  const pending = owned.pending_revision;
  const conflict = (message: string): never => {
    throw new ApiRequestError(409, 'DRAFT_CONFLICT', message);
  };
  if ((value?.pendingRevisionId ?? null) !== (pending?.id ?? null))
    conflict(
      'The pending submission changed or was reviewed. Your local draft has been kept. Reload the overview before editing again.',
    );
  const previous =
    !pending && !owned.published && owned.last_review
      ? await api.getRevision(id, owned.last_review.revision_id)
      : null;
  const stored = pending?.content ?? owned.published ?? previous?.content;
  const base =
    editableContent(stored) ??
    (pending || !owned.published
      ? editableContent(reconstructionContent(stored))
      : null);
  if (!base)
    return conflict(
      'The original content is unavailable. Your local draft has been kept.',
    );
  if (value?.baselineHash !== (await sha256Hex(JSON.stringify(base))))
    conflict(
      'This extension changed since you started editing. Your local draft has been kept. Reload the overview to review it.',
    );
  return { base, payload: applyExtensionDraft(base, draft), pending };
}
