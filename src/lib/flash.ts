import type { AstroSession } from 'astro';

// One-shot flash messages carried across a POST -> redirect -> GET cycle via
// Astro's built-in session (Cloudflare KV-backed, auto-provisioned by the
// adapter) — distinct from this app's own signed auth-cookie session
// (getSessionUser/SESSION_SECRET, see lib/session.ts). Keeps confirmation
// and error messages out of the URL entirely, rather than passing them as
// query params.
export interface FlashMessage {
  category?: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
}

export function setFlash(
  session: AstroSession | undefined,
  message: FlashMessage,
): void {
  session?.set('flash', message);
}

// Reads and clears the flash in one call — it's meant to be shown exactly
// once, so reloading the page after the toast has rendered must not
// resurface it.
export async function takeFlash(
  session: AstroSession | undefined,
): Promise<FlashMessage | undefined> {
  const message = await session?.get('flash');
  if (message) session?.delete('flash');
  return message;
}
