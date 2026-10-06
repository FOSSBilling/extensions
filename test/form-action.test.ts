import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/client';
import { FLASH_COOKIE, takeFlash } from '@/lib/flash';
import { formAction } from '@/lib/form-action';
import { fakeCookies } from './helpers/fake-cookies';
import { makeEnv } from './helpers/env';

const env = makeEnv();

type ActionOptions = Parameters<typeof formAction>[0];
type ActionContext = Parameters<ReturnType<typeof formAction>>[0];

function makeContext(body?: FormData | Error) {
  const jar = fakeCookies();
  return {
    jar,
    context: {
      cookies: jar.cookies,
      url: new URL('https://extensions.example.test/account'),
      redirect: vi.fn(
        (path: string) =>
          new Response(null, { status: 302, headers: { location: path } }),
      ),
      request: {
        formData: vi.fn(
          typeof body === 'object' && body instanceof Error
            ? async () => {
                throw body;
              }
            : async () => body ?? new FormData(),
        ),
      },
      locals: { env },
    } as unknown as ActionContext,
  };
}

function makeAction(
  overrides: Partial<ActionOptions>,
  run: ActionOptions['run'],
) {
  return formAction({
    guard: (async () => ({
      sub: 'user-subject',
    })) as unknown as ActionOptions['guard'],
    redirect: '/account',
    fallbackError: 'Something went wrong.',
    run,
    ...overrides,
  } as ActionOptions);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('formAction', () => {
  it('runs the handler and lands on the default redirect without flashing', async () => {
    const { jar, context } = makeContext();
    const run = vi.fn(async () => {});

    const response = await makeAction({}, run)(context);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/account');
    expect(run).toHaveBeenCalledOnce();
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('returns the guard response untouched when authentication fails', async () => {
    const { jar, context } = makeContext();
    const guardResponse = new Response(null, { status: 302 });
    const action = makeAction(
      {
        guard: (async () => guardResponse) as unknown as ActionOptions['guard'],
      },
      async () => {},
    );

    const response = await action(context);

    expect(response).toBe(guardResponse);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('flashes "Malformed request." and redirects when a required body is unreadable', async () => {
    const { jar, context } = makeContext(new Error('bad body'));
    const run = vi.fn(async () => {});

    const response = await makeAction({ parse: () => ({}) }, run)(context);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/account');
    expect(jar.set).toHaveBeenCalledWith(
      FLASH_COOKIE,
      expect.any(String),
      expect.any(Object),
    );
    await expect(
      takeFlash(jar.cookies, env.sessionSecret),
    ).resolves.toMatchObject({
      category: 'error',
      title: 'Malformed request.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('feeds the fallback input to run when an optional body is unreadable', async () => {
    const { jar, context } = makeContext(new Error('bad body'));
    const run = vi.fn(async () => {});

    await makeAction(
      {
        parse: (form: FormData) => ({ notify: form.get('notify') === 'on' }),
        required: false,
        fallback: { notify: true },
      },
      run,
    )(context);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { notify: true } }),
    );
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('flashes a validation message from parse without running the handler', async () => {
    const { jar, context } = makeContext(new FormData());
    const run = vi.fn(async () => {});

    const response = await makeAction(
      {
        parse: () => 'A reason is required.',
      },
      run,
    )(context);

    expect(response.status).toBe(302);
    await expect(
      takeFlash(jar.cookies, env.sessionSecret),
    ).resolves.toMatchObject({
      category: 'error',
      title: 'A reason is required.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('lands on the fallback error path when parse itself throws', async () => {
    const { jar, context } = makeContext(new FormData());
    const run = vi.fn(async () => {});
    const parse = vi.fn(() => {
      throw new Error('parser bug');
    });

    const response = await makeAction({ parse }, run)(context);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/account');
    await expect(
      takeFlash(jar.cookies, env.sessionSecret),
    ).resolves.toMatchObject({
      category: 'error',
      title: 'Something went wrong.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('hands the parsed input to run', async () => {
    const { context } = makeContext(new FormData());
    const run = vi.fn(async () => {});

    await makeAction({ parse: () => ({ id: 'ext-1' }) }, run)(context);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ input: { id: 'ext-1' } }),
    );
  });

  it('flashes friendly copy for ApiRequestError failures', async () => {
    const { jar, context } = makeContext();
    const run = vi.fn(async () => {
      throw new ApiRequestError(429, 'RATE_LIMITED', 'upstream says no');
    });

    const response = await makeAction({}, run)(context);

    expect(response.status).toBe(302);
    await expect(
      takeFlash(jar.cookies, env.sessionSecret),
    ).resolves.toMatchObject({
      category: 'error',
      title:
        'Too many requests were made. Please wait a few minutes and try again.',
    });
  });

  it('logs non-API failures and flashes the fallback copy', async () => {
    const { jar, context } = makeContext();
    const run = vi.fn(async () => {
      throw new Error('handler bug');
    });

    const response = await makeAction({}, run)(context);

    expect(response.status).toBe(302);
    await expect(
      takeFlash(jar.cookies, env.sessionSecret),
    ).resolves.toMatchObject({
      category: 'error',
      title: 'Something went wrong.',
    });
    expect(console.error).toHaveBeenCalledWith(
      '[form-action] handler failed:',
      expect.any(Error),
    );
  });

  it('lets run override the landing spot with a redirect target', async () => {
    const { context } = makeContext();
    const run = vi.fn(async () => '/somewhere-else');

    const response = await makeAction({}, run)(context);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/somewhere-else');
  });

  it('lets run return a full response', async () => {
    const { context } = makeContext();
    const runResponse = new Response(null, { status: 303 });
    const run = vi.fn(async () => runResponse);

    const response = await makeAction({}, run)(context);

    expect(response).toBe(runResponse);
  });
});
