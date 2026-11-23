import { describe, expect, it, vi } from 'vitest';
import { ApiError, createTrade, fetchMe, listTrades } from './api.ts';

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
      fieldErrors: {
        plannedStop: ['plannedStop must be below entryPrice for a long'],
      },
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

  it.each([401, 500])(
    'throws an ApiError with status %i and no body',
    async (code) => {
      const err = await createTrade(
        apiUrl,
        'tok',
        body,
        respond('{"message":"x"}', code),
      ).catch((e: unknown) => e);
      expect((err as ApiError).status).toBe(code);
      expect((err as ApiError).body).toBeUndefined();
    },
  );

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

describe('listTrades', () => {
  const trade = {
    id: '3f0c1c52-6a3a-4f0e-9d0c-8a8f4f3b7a11',
    symbol: 'AAPL',
    instrumentType: 'stock',
    side: 'long',
    quantity: '1',
    entryPrice: '5',
    openedAt: '2026-10-09T13:45:00.000Z',
    fees: '0',
    createdAt: '2026-10-09T13:46:00.000Z',
    updatedAt: '2026-10-09T13:46:00.000Z',
    metrics: {},
  };

  it('sends from, to, limit and cursor, plus the bearer token', async () => {
    const fetchFn = respond(JSON.stringify({ items: [] }));
    await listTrades(
      apiUrl,
      'tok',
      {
        from: '2026-10-01T04:00:00.000Z',
        to: '2026-11-01T04:00:00.000Z',
        limit: 100,
        cursor: 'abc/+=',
      },
      fetchFn,
    );
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${apiUrl}/trades`);
    expect(parsed.searchParams.get('from')).toBe('2026-10-01T04:00:00.000Z');
    expect(parsed.searchParams.get('to')).toBe('2026-11-01T04:00:00.000Z');
    expect(parsed.searchParams.get('limit')).toBe('100');
    expect(parsed.searchParams.get('cursor')).toBe('abc/+=');
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('leaves out parameters that are not given', async () => {
    const fetchFn = respond(JSON.stringify({ items: [] }));
    await listTrades(apiUrl, 'tok', { limit: 100 }, fetchFn);
    const url = new URL(vi.mocked(fetchFn).mock.calls[0]![0] as string);
    expect([...url.searchParams.keys()]).toEqual(['limit']);
  });

  it('builds the URL with a query string only when there are parameters', async () => {
    const none = respond(JSON.stringify({ items: [] }));
    await listTrades(apiUrl, 'tok', {}, none);
    expect(vi.mocked(none).mock.calls[0]![0]).toBe(`${apiUrl}/trades`);
    const some = respond(JSON.stringify({ items: [] }));
    await listTrades(apiUrl, 'tok', { limit: 100, cursor: 'a b' }, some);
    expect(vi.mocked(some).mock.calls[0]![0]).toBe(
      `${apiUrl}/trades?limit=100&cursor=a+b`,
    );
  });

  it.each(['abc', '1e5', '', '1.', '.5', '+5', ' 5'])(
    'throws status 0 when a trade has a malformed netPnl %j',
    async (netPnl) => {
      const bad = { ...trade, metrics: { netPnl } };
      const err = await listTrades(
        apiUrl,
        'tok',
        {},
        respond(JSON.stringify({ items: [trade, bad] })),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
    },
  );

  it.each(['abc', '1e5', '', '1.', '.5', '+5', ' 5'])(
    'throws status 0 when a trade has a malformed rMultiple %j',
    async (rMultiple) => {
      const bad = { ...trade, metrics: { netPnl: '1', rMultiple } };
      const err = await listTrades(
        apiUrl,
        'tok',
        {},
        respond(JSON.stringify({ items: [trade, bad] })),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
    },
  );

  it.each(['0', '-1.08', '1.98', '12'])('accepts rMultiple %s', async (r) => {
    const page = await listTrades(
      apiUrl,
      'tok',
      {},
      respond(
        JSON.stringify({
          items: [{ ...trade, metrics: { netPnl: '1', rMultiple: r } }],
        }),
      ),
    );
    expect(page.items[0]!.metrics.rMultiple).toBe(r);
  });

  it.each(['0', '-21.62', '98.76', '1000'])(
    'accepts netPnl %s',
    async (netPnl) => {
      const page = await listTrades(
        apiUrl,
        'tok',
        {},
        respond(JSON.stringify({ items: [{ ...trade, metrics: { netPnl } }] })),
      );
      expect(page.items[0]!.metrics.netPnl).toBe(netPnl);
    },
  );

  it('parses a page with a nextCursor', async () => {
    const page = await listTrades(
      apiUrl,
      'tok',
      {},
      respond(JSON.stringify({ items: [trade], nextCursor: 'next' })),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.symbol).toBe('AAPL');
    expect(page.nextCursor).toBe('next');
  });

  it('parses the last page, with no nextCursor', async () => {
    const page = await listTrades(
      apiUrl,
      'tok',
      {},
      respond(JSON.stringify({ items: [] })),
    );
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it.each([400, 401, 500])(
    'throws an ApiError carrying status %i',
    async (code) => {
      const err = await listTrades(
        apiUrl,
        'tok',
        {},
        respond(JSON.stringify({ message: 'x' }), code),
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(code);
    },
  );

  it('throws status 0 for a bad body', async () => {
    for (const body of [
      JSON.stringify({ nope: 1 }),
      JSON.stringify({ items: [{ ...trade, openedAt: 'yesterday' }] }),
      '<html></html>',
    ]) {
      const err = await listTrades(apiUrl, 'tok', {}, respond(body)).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
    }
  });

  it('passes the abort signal to fetch', async () => {
    const fetchFn = respond(JSON.stringify({ items: [] }));
    const controller = new AbortController();
    await listTrades(apiUrl, 'tok', {}, fetchFn, controller.signal);
    expect(vi.mocked(fetchFn).mock.calls[0]![1]?.signal).toBe(
      controller.signal,
    );
  });

  it('propagates a network error', async () => {
    const fetchFn = (() =>
      Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await expect(listTrades(apiUrl, 'tok', {}, fetchFn)).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
