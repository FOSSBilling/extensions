import type { APIRoute, APIContext } from 'astro';
import type { AuthenticatedUser } from './auth-guard';
import { ApiRequestError, getApiErrorMessage } from './api/client';
import { setFlash } from './flash';
import type { ApplicationEnv } from './runtime';

// Shared scaffolding for the POST route handlers: authenticate via a guard,
// optionally parse the request body into a typed input, flash a friendly
// error on failure, and always land on a redirect. A handler file supplies
// only its unique core — param checks, the API call, and its success and
// warning flashes.
//
// `run` may return a redirect target (or a Response) to leave early without
// the factory flashing anything — used both for "missing param" exits and
// for success paths that land somewhere other than `redirect`.
export function formAction<P = undefined>(options: {
  guard: (
    context: APIContext,
    env: ApplicationEnv,
  ) => Promise<AuthenticatedUser | Response>;
  // Error flash title when `run` throws something that isn't an
  // ApiRequestError. ApiRequestErrors map through getApiErrorMessage, so
  // rate limits and outages read the same here as on page loads.
  fallbackError: string;
  // Landing spot for the error and default-success paths.
  redirect: string | ((context: APIContext) => string);
  // Reads the request body into run's input. Returning a string flashes it
  // as a validation error and redirects. When `required` (the default) an
  // unreadable body flashes "Malformed request." and redirects; otherwise
  // an unreadable body leaves `input` at `fallback` so the handler's
  // defaults stand. Omit `parse` entirely for handlers with no body.
  parse?: (form: FormData) => P | string;
  required?: boolean;
  fallback?: P;
  run: (input: {
    context: APIContext;
    env: ApplicationEnv;
    user: AuthenticatedUser;
    input: P;
  }) => Promise<Response | string | void>;
}): APIRoute {
  return async (context) => {
    const env = context.locals.env;
    const guard = await options.guard(context, env);
    if (guard instanceof Response) return guard;
    const user = guard;

    const redirectTo = () =>
      context.redirect(
        typeof options.redirect === 'function'
          ? options.redirect(context)
          : options.redirect,
      );
    const flashError = (title: string) =>
      setFlash(context, env.sessionSecret, { category: 'error', title });

    let input: P;
    if (!options.parse) {
      input = undefined as P;
    } else {
      let form: FormData | undefined;
      try {
        form = await context.request.formData();
      } catch {
        form = undefined;
      }
      if (form === undefined && (options.required ?? true)) {
        await flashError('Malformed request.');
        return redirectTo();
      }
      if (form === undefined) {
        input = options.fallback as P;
      } else {
        const parsed = options.parse(form);
        if (typeof parsed === 'string') {
          await flashError(parsed);
          return redirectTo();
        }
        input = parsed;
      }
    }

    try {
      const result = await options.run({ context, env, user, input });
      if (result instanceof Response) return result;
      if (typeof result === 'string') return context.redirect(result);
    } catch (e) {
      await flashError(
        e instanceof ApiRequestError
          ? getApiErrorMessage(e)
          : options.fallbackError,
      );
    }

    return redirectTo();
  };
}
