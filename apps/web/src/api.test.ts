import { describe, expect, it, vi } from 'vitest';
import { ApiError, fetchMe } from './api.ts';

const apiUrl = 'https://abc123defg.execute-api.ap-southeast-2.amazonaws.com';

const respond = (body: string, status = 200) =>
  vi.fn(() =>
    Promise.resolve(new Response(body, { status })),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('fetchMe', () => {
  it('sends the bearer token to /me and returns the parsed body', async () => {
    const fetchFn = respond(JSON.stringify({ userId: 'sub-1' }));
    await expect(fetchMe(apiUrl, 'tok', fetchFn)).resolves.toEqual({
      userId: 'sub-1',
    });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe(`${apiUrl}/me`);
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it.each([401, 500])('throws an ApiError carrying status %i', async (code) => {
    const fetchFn = respond(JSON.stringify({ message: 'x' }), code);
    const err = await fetchMe(apiUrl, 'tok', fetchFn).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(code);
  });

  it('throws on a schema-invalid body', async () => {
    await expect(
      fetchMe(apiUrl, 'tok', respond(JSON.stringify({ userId: '' }))),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      fetchMe(apiUrl, 'tok', respond(JSON.stringify({ other: 1 }))),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('throws on a non-JSON body', async () => {
    await expect(
      fetchMe(apiUrl, 'tok', respond('<html></html>')),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates a network error', async () => {
    const fetchFn = (() =>
      Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await expect(fetchMe(apiUrl, 'tok', fetchFn)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
