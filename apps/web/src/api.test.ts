import { describe, expect, it, vi } from 'vitest';
import { ApiError, createTrade, fetchMe } from './api.ts';

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

describe('createTrade', () => {
  const body = {
    symbol: 'MES',
    instrumentType: 'future',
    side: 'long',
    quantity: '2',
    pointValue: '5',
    entryPrice: '5000',
    openedAt: '2026-11-19T14:30:00.000Z',
  } as const;
  const view = {
    ...body,
    id: '3f0c1c52-6a3a-4f0e-9d0c-8a8f4f3b7a11',
    fees: '0',
    createdAt: '2026-11-19T14:31:00.000Z',
    updatedAt: '2026-11-19T14:31:00.000Z',
    metrics: {},
  };

  it('POSTs the JSON body with the bearer token and returns the TradeView', async () => {
    const fetchFn = respond(JSON.stringify(view), 201);
    const trade = await createTrade(apiUrl, 'tok', body, fetchFn);
    expect(trade.id).toBe(view.id);
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe(`${apiUrl}/trades`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it('carries the parsed ErrorBody on a 400', async () => {
    const errorBody = {
      message: 'Invalid trade',
      fieldErrors: { plannedStop: ['plannedStop must be below entryPrice for a long'] },
      formErrors: [],
    };
    const fetchFn = respond(JSON.stringify(errorBody), 400);
    const err = await createTrade(apiUrl, 'tok', body, fetchFn).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).body).toEqual(errorBody);
  });

  it.each([401, 500])('throws an ApiError with status %i and no body', async (code) => {
    const err = await createTrade(
      apiUrl,
      'tok',
      body,
      respond('{"message":"x"}', code),
    ).catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(code);
    expect((err as ApiError).body).toBeUndefined();
  });

  it('throws status 0 for a malformed 201', async () => {
    const err = await createTrade(
      apiUrl,
      'tok',
      body,
      respond('{"nope":1}', 201),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });
});
