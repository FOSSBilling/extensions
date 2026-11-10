import type { APIRoute } from 'astro';
import { packageResponse } from '@/lib/package-response';
export const GET: APIRoute = (context) => packageResponse(context, 'icon');
