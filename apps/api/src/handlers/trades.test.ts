import {
  ErrorBodySchema,
  ListTradesResponseSchema,
  TradeViewSchema,
} from '@trade-journal/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryTradeStore } from '../lib/memory-trade-store.js';
import type { TradeStore } from '../lib/trade-store.js';
import { makeHandler as makeCreate } from './create-trade.js';
import { makeHandler as makeGet } from './get-trade.js';
import { makeHandler as makeList } from './list-trades.js';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Res = {
  statusCode?: number;
  headers?: Record<string, unknown>;
  body?: string;
};

const authEvent = (authorizer: unknown, extra: Record<string, unknown> = {}) =>
  ({
    requestContext: authorizer === undefined ? {} : { authorizer },
    ...extra,
  }) as unknown as Event;

const claims = (
  c: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  authEvent(
    { jwt: { claims: { token_use: 'access', ...c }, scopes: [] } },
    extra,
  );

const as = (sub: string, extra: Record<string, unknown> = {}) =>
  claims({ sub }, extra);

const exampleA = {
  symbol: 'mes',
  instrumentType: 'future',
  side: 'long',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  exitPrice: '5010',
  openedAt: '2026-11-19T01:30:00Z',
  closedAt: '2026-11-19T02:00:00Z',
  fees: '1.24',
  plannedStop: '4995',
};

const omit = (o: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const FIXED = new Date('2026-11-19T12:00:00.000Z');

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const makeEnv = (store: TradeStore = new MemoryTradeStore()) => {
  let n = 0;
  const deps = { store, now: () => FIXED, newId: () => uuid(++n) };
  return {
    store,
    create: makeCreate(deps),
    get: makeGet(deps),
    list: makeList(deps),
  };
};

const parse = (res: Res) => JSON.parse(res.body ?? '') as unknown;

const postTrade = (
  env: ReturnType<typeof makeEnv>,
  sub: string,
  body: Record<string, unknown>,
) => env.create(as(sub, { body: JSON.stringify(body) })) as Promise<Res>;

const listFor = (
  env: ReturnType<typeof makeEnv>,
  sub: string,
  q?: Record<string, string>,
) => env.list(as(sub, q ? { queryStringParameters: q } : {})) as Promise<Res>;

type Page = { items: { id: string }[]; nextCursor?: string };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('round trip', () => {
  it('creates, gets and lists the same trade with the same metrics', async () => {
    const env = makeEnv();
    const created = await postTrade(env, 'a', exampleA);
    expect(created.statusCode).toBe(201);
    const view = TradeViewSchema.parse(parse(created));
    expect(view.id).toBe(uuid(1));
    expect(view.createdAt).toBe('2026-11-19T12:00:00.000Z');
    expect(view.updatedAt).toBe(view.createdAt);
    expect(view.metrics.netPnl).toBe('98.76');
    expect(view.metrics.rMultiple).toBe('1.98');
    expect(view.metrics.grossPnl).toBe('100');

    const got = (await env.get(
      as('a', { pathParameters: { id: view.id } }),
    )) as Res;
    expect(got.statusCode).toBe(200);
    expect(parse(got)).toEqual(view);

    const listed = ListTradesResponseSchema.parse(
      parse(await listFor(env, 'a')),
    );
    expect(listed.items).toEqual([view]);
    expect(listed.nextCursor).toBeUndefined();
  });

  it('returns empty metrics for an open trade without a stop', async () => {
    const env = makeEnv();
    const open = omit(exampleA, 'closedAt', 'exitPrice', 'plannedStop');
    const res = await postTrade(env, 'a', open);
    expect(res.statusCode).toBe(201);
    expect((parse(res) as { metrics: unknown }).metrics).toEqual({});
  });

  it('has json content type and no-store on every handler', async () => {
    const env = makeEnv();
    const created = await postTrade(env, 'a', exampleA);
    const id = (parse(created) as { id: string }).id;
    const responses: Res[] = [
      created,
      (await env.get(as('a', { pathParameters: { id } }))) as Res,
      (await env.get(as('b', { pathParameters: { id } }))) as Res,
      await listFor(env, 'a'),
      await listFor(env, 'a', { limit: '0' }),
      (await env.create(as('a', { body: 'nope' }))) as Res,
      (await env.list(authEvent(undefined))) as Res,
    ];
    for (const r of responses) {
      expect(r.headers?.['cache-control']).toBe('no-store');
      expect(r.headers?.['content-type']).toBe('application/json');
    }
  });

  it('accepts a base64-encoded body', async () => {
    const env = makeEnv();
    const res = (await env.create(
      as('a', {
        isBase64Encoded: true,
        body: Buffer.from(JSON.stringify(exampleA)).toString('base64'),
      }),
    )) as Res;
    expect(res.statusCode).toBe(201);
  });
});

describe('isolation between users', () => {
  it('gives user B 404 for A trade and omits it from B list', async () => {
    const env = makeEnv();
    const id = (parse(await postTrade(env, 'a', exampleA)) as { id: string })
      .id;

    const res = (await env.get(as('b', { pathParameters: { id } }))) as Res;
    expect(res.statusCode).toBe(404);
    expect(parse(res)).toEqual({ message: 'Trade not found' });

    const list = parse(await listFor(env, 'b')) as Page;
    expect(list.items).toEqual([]);
    expect((parse(await listFor(env, 'a')) as Page).items).toHaveLength(1);
  });

  it('rejects a userId supplied in the body', async () => {
    const env = makeEnv();
    const res = await postTrade(env, 'a', { ...exampleA, userId: 'b' });
    expect(res.statusCode).toBe(400);
  });

  it('ignores a userId supplied in the query or path', async () => {
    const env = makeEnv();
    const id = (parse(await postTrade(env, 'a', exampleA)) as { id: string })
      .id;

    const list = (await env.list(
      as('b', { queryStringParameters: { userId: 'a' } }),
    )) as Res;
    expect(list.statusCode).toBe(200);
    expect((parse(list) as Page).items).toEqual([]);

    const get = (await env.get(
      as('b', { pathParameters: { id, userId: 'a' } }),
    )) as Res;
    expect(get.statusCode).toBe(404);
  });

  it('finds the caller’s trade by an upper-cased id', async () => {
    const env = makeEnv();
    const id = (parse(await postTrade(env, 'a', exampleA)) as { id: string })
      .id;
    const res = (await env.get(
      as('a', { pathParameters: { id: id.toUpperCase() } }),
    )) as Res;
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for a non-UUID or missing id', async () => {
    const env = makeEnv();
    for (const id of ['abc', '123', '../me', '', undefined]) {
      const res = (await env.get(
        as('a', { pathParameters: id === undefined ? {} : { id } }),
      )) as Res;
      expect(res.statusCode).toBe(404);
      expect(parse(res)).toEqual({ message: 'Trade not found' });
    }
    const unknown = (await env.get(
      as('a', { pathParameters: { id: uuid(99) } }),
    )) as Res;
    expect(unknown.statusCode).toBe(404);
  });
});

describe('create validation', () => {
  const expect400 = async (body: Record<string, unknown>) => {
    const env = makeEnv();
    const res = await postTrade(env, 'a', body);
    expect(res.statusCode).toBe(400);
    const parsed = parse(res) as {
      message: string;
      fieldErrors: Record<string, string[]>;
      formErrors: string[];
    };
    expect(parsed.message).toBe('Invalid trade');
    expect(parsed.fieldErrors).toBeTypeOf('object');
    expect(Array.isArray(parsed.formErrors)).toBe(true);
    // Nothing was stored.
    expect((parse(await listFor(env, 'a')) as Page).items).toEqual([]);
    return parsed;
  };

  it('rejects a future without pointValue', async () => {
    const body = omit(exampleA, 'pointValue');
    const err = await expect400(body);
    expect(Object.keys(err.fieldErrors)).toContain('pointValue');
  });

  it('rejects a long stop above entry', async () => {
    const err = await expect400({ ...exampleA, plannedStop: '5005' });
    expect(Object.keys(err.fieldErrors)).toContain('plannedStop');
  });

  it('rejects a short stop below entry', async () => {
    const err = await expect400({
      ...exampleA,
      side: 'short',
      plannedStop: '4995',
    });
    expect(Object.keys(err.fieldErrors)).toContain('plannedStop');
  });

  it('rejects an unknown key such as planedStop', async () => {
    const rest = omit(exampleA, 'plannedStop');
    const err = await expect400({ ...rest, planedStop: '4995' });
    expect(JSON.stringify(err)).toContain('planedStop');
  });

  it.each(['id', 'createdAt', 'updatedAt'])(
    'rejects %s in the body',
    async (k) => {
      const err = await expect400({
        ...exampleA,
        [k]: k === 'id' ? uuid(7) : '2026-01-01T00:00:00Z',
      });
      expect(JSON.stringify(err)).toContain(k);
    },
  );

  it('returns 400 "Body must be valid JSON" for non-JSON', async () => {
    const env = makeEnv();
    for (const body of ['not json', '{"a":', undefined, '']) {
      const res = (await env.create(
        as('a', body === undefined ? {} : { body }),
      )) as Res;
      expect(res.statusCode).toBe(400);
      expect(parse(res)).toEqual({ message: 'Body must be valid JSON' });
    }
  });

  it('rejects JSON that is not an object', async () => {
    const env = makeEnv();
    for (const body of ['null', '[]', '"x"', '5']) {
      const res = (await env.create(as('a', { body }))) as Res;
      expect(res.statusCode).toBe(400);
      expect(ErrorBodySchema.parse(parse(res)).message).toBe('Invalid trade');
    }
  });

  it('rejects a float-valued money field', async () => {
    await expect400({ ...exampleA, entryPrice: 5000.25 });
  });
});

describe('list ordering and paging', () => {
  const at = (openedAt: string) => ({
    ...exampleA,
    openedAt,
    closedAt: '2026-12-01T00:00:00Z',
  });

  it('orders by openedAt descending, including a back-filled trade', async () => {
    const env = makeEnv();
    const newer = parse(
      await postTrade(env, 'a', at('2026-11-19T10:00:00Z')),
    ) as { id: string };
    const older = parse(
      await postTrade(env, 'a', at('2026-11-12T10:00:00Z')),
    ) as { id: string };
    const mid = parse(
      await postTrade(env, 'a', at('2026-11-15T10:00:00Z')),
    ) as { id: string };
    const page = parse(await listFor(env, 'a')) as Page;
    expect(page.items.map((i) => i.id)).toEqual([newer.id, mid.id, older.id]);
  });

  it('orders fractional seconds by time, not by string', async () => {
    const env = makeEnv();
    const whole = parse(
      await postTrade(env, 'a', at('2026-11-19T10:00:00Z')),
    ) as { id: string };
    const half = parse(
      await postTrade(env, 'a', at('2026-11-19T10:00:00.5Z')),
    ) as { id: string };
    const ms = parse(
      await postTrade(env, 'a', at('2026-11-19T10:00:00.001Z')),
    ) as { id: string };
    const page = parse(await listFor(env, 'a')) as Page;
    expect(page.items.map((i) => i.id)).toEqual([half.id, ms.id, whole.id]);
  });

  it('breaks openedAt ties by id, newest key first', async () => {
    const env = makeEnv();
    const a = parse(await postTrade(env, 'a', at('2026-11-19T10:00:00Z'))) as {
      id: string;
    };
    const b = parse(await postTrade(env, 'a', at('2026-11-19T10:00:00Z'))) as {
      id: string;
    };
    const page = parse(await listFor(env, 'a')) as Page;
    expect(page.items.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it('pages with limit and nextCursor, each trade exactly once', async () => {
    const env = makeEnv();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = String(10 + i).padStart(2, '0');
      const t = parse(
        await postTrade(env, 'a', at(`2026-11-${day}T10:00:00Z`)),
      ) as { id: string };
      ids.push(t.id);
    }
    const expected = [...ids].reverse();

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await listFor(env, 'a', {
        limit: '3',
        ...(cursor ? { cursor } : {}),
      });
      expect(res.statusCode).toBe(200);
      const page = ListTradesResponseSchema.parse(parse(res));
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(7);
  });

  it('allows an empty final page after a full one', async () => {
    const env = makeEnv();
    await postTrade(env, 'a', at('2026-11-10T10:00:00Z'));
    await postTrade(env, 'a', at('2026-11-11T10:00:00Z'));
    const first = parse(await listFor(env, 'a', { limit: '2' })) as Page;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTypeOf('string');
    const second = parse(
      await listFor(env, 'a', { limit: '2', cursor: first.nextCursor ?? '' }),
    ) as Page;
    expect(second.items).toEqual([]);
    expect(second.nextCursor).toBeUndefined();
  });

  it('omits nextCursor when the page is not full', async () => {
    const env = makeEnv();
    await postTrade(env, 'a', at('2026-11-10T10:00:00Z'));
    const page = parse(await listFor(env, 'a', { limit: '5' })) as Page;
    expect('nextCursor' in page).toBe(false);
  });

  it('defaults to 25 items and accepts limit 1 and 100', async () => {
    const env = makeEnv();
    for (let i = 0; i < 26; i++) {
      const hh = String(i % 24).padStart(2, '0');
      const day = String(1 + Math.floor(i / 24)).padStart(2, '0');
      await postTrade(env, 'a', at(`2026-11-${day}T${hh}:00:00Z`));
    }
    expect((parse(await listFor(env, 'a')) as Page).items).toHaveLength(25);
    expect(
      (parse(await listFor(env, 'a', { limit: '1' })) as Page).items,
    ).toHaveLength(1);
    expect(
      (parse(await listFor(env, 'a', { limit: '100' })) as Page).items,
    ).toHaveLength(26);
  });

  it.each(['0', '101', 'abc', '1.5', '-1', '', ' 5', '1e1'])(
    'rejects limit %j with 400',
    async (limit) => {
      const env = makeEnv();
      const res = await listFor(env, 'a', { limit });
      expect(res.statusCode).toBe(400);
      const body = parse(res) as {
        message: string;
        fieldErrors: Record<string, unknown>;
      };
      expect(body.message).toBe('Invalid query');
      expect(body.fieldErrors).toHaveProperty('limit');
    },
  );

  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');

  it.each([
    ['garbage', 'not-a-cursor!!'],
    ['empty JSON object', b64({})],
    ['wrong types', b64({ sk: 1, openedAtKey: 2 })],
    ['missing field', b64({ sk: 'TRADE#x' })],
    ['extra pk field', b64({ pk: 'USER#b', sk: 'TRADE#x', openedAtKey: 'k' })],
    ['JSON null', b64(null)],
    ['not JSON', Buffer.from('hello').toString('base64url')],
  ])('rejects a bad cursor: %s', async (_name, cursor) => {
    const env = makeEnv();
    const res = await listFor(env, 'a', { cursor });
    expect(res.statusCode).toBe(400);
    const body = parse(res) as {
      message: string;
      fieldErrors: Record<string, unknown>;
    };
    expect(body.message).toBe('Invalid query');
    expect(body.fieldErrors).toHaveProperty('cursor');
  });

  it('rejects a tampered real cursor', async () => {
    const env = makeEnv();
    await postTrade(env, 'a', at('2026-11-10T10:00:00Z'));
    const first = parse(await listFor(env, 'a', { limit: '1' })) as Page;
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    const res = await listFor(env, 'a', { cursor: cursor.slice(0, -4) });
    expect(res.statusCode).toBe(400);
  });
});

describe('401 for every handler', () => {
  const cases: [string, Event][] = [
    ['an ID token', claims({ sub: 'u', token_use: 'id' })],
    [
      'missing token_use',
      authEvent({ jwt: { claims: { sub: 'u' }, scopes: [] } }),
    ],
    ['a missing authorizer', authEvent(undefined)],
    ['no sub', claims({ client_id: 'abc' })],
    ['an empty sub', claims({ sub: '' })],
    ['a non-string sub', claims({ sub: 42 })],
  ];

  const withExtras = (e: Event, extra: Record<string, unknown>) =>
    ({ ...e, ...extra }) as Event;

  describe.each(cases)('%s', (_name, ev) => {
    it.each([
      [
        'create-trade',
        (env: ReturnType<typeof makeEnv>) =>
          env.create(withExtras(ev, { body: JSON.stringify(exampleA) })),
      ],
      [
        'get-trade',
        (env: ReturnType<typeof makeEnv>) =>
          env.get(withExtras(ev, { pathParameters: { id: uuid(1) } })),
      ],
      ['list-trades', (env: ReturnType<typeof makeEnv>) => env.list(ev)],
    ])('%s returns 401', async (_h, call) => {
      const env = makeEnv();
      const res = (await call(env)) as Res;
      expect(res.statusCode).toBe(401);
      expect(res.headers?.['content-type']).toBe('application/json');
      expect(res.headers?.['cache-control']).toBe('no-store');
      expect(parse(res)).toEqual({ message: 'Unauthorized' });
    });
  });

  it('create does not store anything when unauthorised', async () => {
    const env = makeEnv();
    await env.create(
      withExtras(claims({ sub: 'u', token_use: 'id' }), {
        body: JSON.stringify(exampleA),
      }),
    );
    expect((parse(await listFor(env, 'u')) as Page).items).toEqual([]);
  });
});

describe('store failure', () => {
  const SECRET = 'secret-table-arn:eu-west-2 AccessDeniedException';
  const failing: TradeStore = {
    put: () => Promise.reject(new Error(SECRET)),
    get: () => Promise.reject(new Error(SECRET)),
    list: () => Promise.reject(new Error(SECRET)),
  };

  const expect500 = (res: Res) => {
    expect(res.statusCode).toBe(500);
    expect(parse(res)).toEqual({ message: 'Internal error' });
    expect(res.body).not.toContain('secret');
    expect(res.body).not.toContain('AccessDenied');
    expect(res.headers?.['cache-control']).toBe('no-store');
  };

  it('returns a bare 500 from create, get and list', async () => {
    const env = makeEnv(failing);
    expect500(await postTrade(env, 'a', exampleA));
    expect500(
      (await env.get(as('a', { pathParameters: { id: uuid(1) } }))) as Res,
    );
    expect500(await listFor(env, 'a'));
  });

  it('logs the error detail instead of returning it', async () => {
    const env = makeEnv(failing);
    await listFor(env, 'a');
    expect(console.error).toHaveBeenCalledWith(
      'list-trades failed',
      expect.objectContaining({ message: SECRET }),
    );
  });

  it('returns 500 for a rejected non-Error value', async () => {
    const env = makeEnv({
      ...failing,
      get: () => Promise.reject('boom' as unknown as Error),
    });
    expect500(
      (await env.get(as('a', { pathParameters: { id: uuid(1) } }))) as Res,
    );
  });
});

describe('list date range', () => {
  const at = (openedAt: string) => ({
    ...exampleA,
    openedAt,
    closedAt: '2027-01-01T00:00:00Z',
  });

  const seed = async (times: string[]) => {
    const env = makeEnv();
    const byTime = new Map<string, string>();
    for (const t of times) {
      const created = parse(await postTrade(env, 'a', at(t))) as {
        id: string;
      };
      byTime.set(t, created.id);
    }
    const ids = (ts: string[]) => ts.map((t) => byTime.get(t));
    return { env, ids };
  };

  const listed = async (
    env: ReturnType<typeof makeEnv>,
    q: Record<string, string>,
  ) => {
    const res = await listFor(env, 'a', q);
    expect(res.statusCode).toBe(200);
    return (parse(res) as Page).items.map((i) => i.id);
  };

  const days = [
    '2026-11-05T10:00:00Z',
    '2026-11-10T10:00:00Z',
    '2026-11-15T10:00:00Z',
    '2026-11-20T10:00:00Z',
  ];

  it('from alone keeps trades at or after it, newest first', async () => {
    const { env, ids } = await seed(days);
    expect(await listed(env, { from: '2026-11-10T10:00:00Z' })).toEqual(
      ids([days[3]!, days[2]!, days[1]!]),
    );
  });

  it('to alone keeps trades before it, newest first', async () => {
    const { env, ids } = await seed(days);
    expect(await listed(env, { to: '2026-11-20T10:00:00Z' })).toEqual(
      ids([days[2]!, days[1]!, days[0]!]),
    );
  });

  it('both keep from inclusive and to exclusive', async () => {
    const { env, ids } = await seed(days);
    expect(
      await listed(env, {
        from: '2026-11-10T10:00:00Z',
        to: '2026-11-20T10:00:00Z',
      }),
    ).toEqual(ids([days[2]!, days[1]!]));
  });

  it('a trade exactly at from is included and exactly at to is excluded', async () => {
    const { env, ids } = await seed(days);
    const q = { from: days[1]!, to: days[2]! };
    expect(await listed(env, q)).toEqual(ids([days[1]!]));
  });

  it('a range with no trades is an empty page', async () => {
    const { env } = await seed(days);
    const res = await listFor(env, 'a', {
      from: '2027-01-01T00:00:00Z',
      to: '2027-02-01T00:00:00Z',
    });
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({ items: [] });
  });

  it('only lists the caller’s trades within the range', async () => {
    const { env } = await seed(days);
    await postTrade(env, 'b', at(days[1]!));
    const res = await listFor(env, 'b', { from: days[0]!, to: days[3]! });
    expect((parse(res) as Page).items).toHaveLength(1);
  });

  it('a range spanning the 1 Nov 2026 DST change is exact at both ends', async () => {
    const times = [
      '2026-11-01T03:59:59Z',
      '2026-11-01T04:00:00Z',
      '2026-11-15T12:00:00Z',
      '2026-12-01T04:59:59.999Z',
      '2026-12-01T05:00:00Z',
    ];
    const { env, ids } = await seed(times);
    expect(
      await listed(env, {
        from: '2026-11-01T04:00:00.000Z',
        to: '2026-12-01T05:00:00.000Z',
      }),
    ).toEqual(ids([times[3]!, times[2]!, times[1]!]));
  });

  it('pads fractional seconds the same way as stored keys', async () => {
    const times = [
      '2026-11-10T10:00:00.4999Z',
      '2026-11-10T10:00:00.5Z',
      '2026-11-10T10:00:00.50001Z',
      '2026-11-10T10:00:00.9999Z',
      '2026-11-10T10:00:01Z',
    ];
    const { env, ids } = await seed(times);
    expect(
      await listed(env, {
        from: '2026-11-10T10:00:00.5Z',
        to: '2026-11-10T10:00:01Z',
      }),
    ).toEqual(ids([times[3]!, times[2]!, times[1]!]));
    // A whole-second bound equals the same instant with a zero fraction.
    expect(
      await listed(env, {
        from: '2026-11-10T10:00:01.000Z',
        to: '2026-11-10T10:00:02Z',
      }),
    ).toEqual(ids([times[4]!]));
  });

  it('pages through a range with the same from and to, each in-range trade once', async () => {
    const times: string[] = [];
    for (let d = 1; d <= 12; d++) {
      times.push(`2026-11-${String(d).padStart(2, '0')}T10:00:00Z`);
    }
    const { env, ids } = await seed(times);
    const q = { from: '2026-11-03T10:00:00Z', to: '2026-11-10T10:00:00Z' };
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await listFor(env, 'a', {
        ...q,
        limit: '3',
        ...(cursor ? { cursor } : {}),
      });
      expect(res.statusCode).toBe(200);
      const page = ListTradesResponseSchema.parse(parse(res));
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    // Nov 3 (at from) to Nov 9; Nov 10 (at to) is out.
    expect(seen).toEqual(ids(times.slice(2, 9).reverse()));
    expect(new Set(seen).size).toBe(7);
  });

  const invalid = async (q: Record<string, string>) => {
    const { env } = await seed(days);
    const res = await listFor(env, 'a', q);
    expect(res.statusCode).toBe(400);
    return parse(res) as {
      message: string;
      fieldErrors: Record<string, string[]>;
    };
  };

  it('rejects from after to with fieldErrors.to', async () => {
    const body = await invalid({
      from: '2026-11-20T00:00:00Z',
      to: '2026-11-10T00:00:00Z',
    });
    expect(body.message).toBe('Invalid query');
    expect(body.fieldErrors.to).toEqual(['to must be after from']);
  });

  it('rejects from equal to to with fieldErrors.to', async () => {
    const body = await invalid({
      from: '2026-11-10T00:00:00Z',
      to: '2026-11-10T00:00:00Z',
    });
    expect(body.message).toBe('Invalid query');
    expect(body.fieldErrors.to).toEqual(['to must be after from']);
  });

  it('compares instants, not strings, when fractions differ', async () => {
    // As plain strings "…00Z" sorts after "…00.5Z", so a string compare
    // would wrongly reject this range.
    const { env } = await seed(days);
    const res = await listFor(env, 'a', {
      from: '2026-11-10T00:00:00Z',
      to: '2026-11-10T00:00:00.5Z',
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts a sub-millisecond range', async () => {
    const { env } = await seed(days);
    const res = await listFor(env, 'a', {
      from: '2026-11-10T00:00:00.0001Z',
      to: '2026-11-10T00:00:00.0009Z',
    });
    expect(res.statusCode).toBe(200);
  });

  it('reports only the bad bound when the other is valid', async () => {
    const f = await invalid({ from: 'bad', to: '2026-11-10T00:00:00Z' });
    expect(f.fieldErrors).toHaveProperty('from');
    expect(f.fieldErrors).not.toHaveProperty('to');
    const t = await invalid({ from: '2026-11-10T00:00:00Z', to: 'tomorrow' });
    expect(t.fieldErrors.to).toHaveLength(1);
    expect(t.fieldErrors.to).not.toContain('to must be after from');
    expect(t.fieldErrors).not.toHaveProperty('from');
  });

  it('rejects a bound with more than 9 fractional digits', async () => {
    const body = await invalid({ from: '2026-11-10T10:00:00.0000000005Z' });
    expect(body.fieldErrors.from).toEqual([
      'Use at most 9 fractional second digits',
    ]);
  });

  it.each(['yesterday', '2026-11-10', '2026-11-10T00:00:00', '', '1700000000'])(
    'rejects a non-ISO from %j',
    async (from) => {
      const body = await invalid({ from });
      expect(body.message).toBe('Invalid query');
      expect(body.fieldErrors).toHaveProperty('from');
      expect(body.fieldErrors).not.toHaveProperty('to');
    },
  );

  it('rejects a non-ISO to on the to key', async () => {
    const body = await invalid({ to: 'tomorrow' });
    expect(body.fieldErrors).toHaveProperty('to');
    expect(body.fieldErrors).not.toHaveProperty('from');
  });

  it('rejects an offset time on from and on to', async () => {
    const f = await invalid({ from: '2026-11-01T00:00:00+11:00' });
    expect(f.fieldErrors).toHaveProperty('from');
    const t = await invalid({ to: '2026-11-01T00:00:00+11:00' });
    expect(t.fieldErrors).toHaveProperty('to');
  });

  it('rejects a cursor from outside the range with the cursor error', async () => {
    const { env } = await seed(days);
    const first = parse(await listFor(env, 'a', { limit: '1' })) as Page;
    const cursor = first.nextCursor ?? '';
    expect(cursor).not.toBe('');
    // The cursor points at the Nov 20 trade; the range ends before it.
    const res = await listFor(env, 'a', {
      cursor,
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-12T00:00:00Z',
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res)).toMatchObject({
      message: 'Invalid query',
      fieldErrors: { cursor: ['cursor is not valid'] },
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    ['from alone', { from: '2026-11-25T00:00:00Z' }],
    ['both', { from: '2026-11-25T00:00:00Z', to: '2026-11-30T00:00:00Z' }],
  ])('rejects a cursor older than from (%s)', async (_, range) => {
    const { env } = await seed(days);
    const page = parse(await listFor(env, 'a', { limit: '1' })) as Page;
    // The cursor points at the Nov 20 trade, before the range starts.
    const res = await listFor(env, 'a', {
      cursor: page.nextCursor ?? '',
      ...range,
    });
    expect(res.statusCode).toBe(400);
    expect(parse(res)).toMatchObject({
      fieldErrors: { cursor: ['cursor is not valid'] },
    });
  });
});
