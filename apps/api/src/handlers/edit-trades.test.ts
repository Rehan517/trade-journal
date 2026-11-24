import {
  ListTradesResponseSchema,
  TradeViewSchema,
  type TradeView,
} from '@trade-journal/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryTradeStore } from '../lib/memory-trade-store.js';
import {
  TradeConflictError,
  TradeNotFoundError,
  type TradeStore,
} from '../lib/trade-store.js';
import { makeHandler as makeCreate } from './create-trade.js';
import { makeHandler as makeDelete } from './delete-trade.js';
import { makeHandler as makeGet } from './get-trade.js';
import { makeHandler as makeList } from './list-trades.js';
import { makeHandler as makeUpdate } from './update-trade.js';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Res = {
  statusCode?: number;
  headers?: Record<string, unknown>;
  body?: string;
};

const claims = (
  c: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  ({
    requestContext: {
      authorizer: {
        jwt: { claims: { token_use: 'access', ...c }, scopes: [] },
      },
    },
    ...extra,
  }) as unknown as Event;
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
// Example H: open, fees 0.62, stop 4995.
const exampleH = {
  symbol: 'MES',
  instrumentType: 'future',
  side: 'long',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  openedAt: '2026-11-19T01:30:00Z',
  fees: '0.62',
  plannedStop: '4995',
};

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const makeEnv = (store: TradeStore = new MemoryTradeStore()) => {
  let n = 0;
  let clock = new Date('2026-11-19T12:00:00.000Z');
  const deps = { store, now: () => clock, newId: () => uuid(++n) };
  return {
    store,
    setNow: (iso: string) => {
      clock = new Date(iso);
    },
    create: makeCreate(deps),
    get: makeGet(deps),
    list: makeList(deps),
    update: makeUpdate(deps),
    del: makeDelete(deps),
  };
};
type Env = ReturnType<typeof makeEnv>;

const parse = (res: Res) => JSON.parse(res.body ?? '') as unknown;

const create = async (env: Env, sub: string, body: object) =>
  TradeViewSchema.parse(
    parse((await env.create(as(sub, { body: JSON.stringify(body) }))) as Res),
  );

const patch = (env: Env, sub: string, id: string, body: unknown) =>
  env.update(
    as(sub, {
      pathParameters: { id },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  ) as Promise<Res>;

const getTrade = (env: Env, sub: string, id: string) =>
  env.get(as(sub, { pathParameters: { id } })) as Promise<Res>;

const listFor = async (env: Env, sub: string) =>
  ListTradesResponseSchema.parse(parse((await env.list(as(sub))) as Res)).items;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PATCH /trades/{id}', () => {
  it('edits example A exit to 5015; get and list agree', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    env.setNow('2026-11-20T00:00:00.000Z');
    const res = await patch(env, 'a', a.id, { exitPrice: '5015' });
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toBe('application/json');
    const view = TradeViewSchema.parse(parse(res));
    expect(view.metrics.netPnl).toBe('148.76');
    expect(view.metrics.rMultiple).toBe('2.98');
    expect(parse(await getTrade(env, 'a', a.id))).toEqual(view);
    expect(await listFor(env, 'a')).toEqual([view]);
  });

  it('changes updatedAt and keeps id and createdAt', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    env.setNow('2026-11-20T00:00:00.000Z');
    const view = TradeViewSchema.parse(
      parse(await patch(env, 'a', a.id, { notes: 'hi' })),
    );
    expect(view.id).toBe(a.id);
    expect(view.createdAt).toBe(a.createdAt);
    expect(view.updatedAt).toBe('2026-11-20T00:00:00.000Z');
    expect(view.updatedAt).not.toBe(a.updatedAt);
    expect(view.notes).toBe('hi');
    expect(view.fees).toBe('1.24');
  });

  it('closes example H with exit and time', async () => {
    const env = makeEnv();
    const h = await create(env, 'a', exampleH);
    expect(h.metrics.netPnl).toBeUndefined();
    const view = TradeViewSchema.parse(
      parse(
        await patch(env, 'a', h.id, {
          exitPrice: '5010',
          closedAt: '2026-11-19T02:00:00Z',
        }),
      ),
    );
    expect(view.metrics.outcome).toBe('win');
    expect(view.metrics.netPnl).toBe('99.38');
  });

  it('reopens a closed trade with both exit fields null', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    const res = await patch(env, 'a', a.id, {
      exitPrice: null,
      closedAt: null,
    });
    expect(res.statusCode).toBe(200);
    const view = TradeViewSchema.parse(parse(res));
    expect(view.exitPrice).toBeUndefined();
    expect(view.metrics.netPnl).toBeUndefined();
    expect(view.metrics.rMultiple).toBeUndefined();
  });

  it('moves the trade in the list when openedAt changes', async () => {
    const env = makeEnv();
    const first = await create(env, 'a', {
      ...exampleA,
      openedAt: '2026-11-19T01:00:00Z',
      closedAt: '2026-11-19T02:00:00Z',
    });
    const second = await create(env, 'a', {
      ...exampleA,
      openedAt: '2026-11-19T01:30:00Z',
    });
    expect((await listFor(env, 'a')).map((t) => t.id)).toEqual([
      second.id,
      first.id,
    ]);
    const res = await patch(env, 'a', first.id, {
      openedAt: '2026-11-19T01:45:00Z',
    });
    expect(res.statusCode).toBe(200);
    expect((await listFor(env, 'a')).map((t) => t.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('accepts a base64 body and an upper-cased id', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    const res = (await env.update(
      as('a', {
        pathParameters: { id: a.id.toUpperCase() },
        isBase64Encoded: true,
        body: Buffer.from(JSON.stringify({ notes: 'b64' })).toString('base64'),
      }),
    )) as Res;
    expect(res.statusCode).toBe(200);
    expect((parse(res) as TradeView).notes).toBe('b64');
  });

  describe('400', () => {
    const open = (env: Env) => create(env, 'a', exampleH);

    it('exit price without exit time on an open trade', async () => {
      const env = makeEnv();
      const h = await open(env);
      const res = await patch(env, 'a', h.id, { exitPrice: '5010' });
      expect(res.statusCode).toBe(400);
      const body = parse(res) as {
        message: string;
        fieldErrors: Record<string, string[]>;
      };
      expect(body.message).toBe('Invalid trade');
      expect(body.fieldErrors.closedAt).toBeDefined();
    });

    it('a stock with a point value', async () => {
      const env = makeEnv();
      const h = await open(env);
      const res = await patch(env, 'a', h.id, { instrumentType: 'stock' });
      expect(res.statusCode).toBe(400);
      expect(
        (parse(res) as { fieldErrors: Record<string, string[]> }).fieldErrors
          .pointValue,
      ).toBeDefined();
    });

    it('a stop moved to the wrong side', async () => {
      const env = makeEnv();
      const h = await open(env);
      const res = await patch(env, 'a', h.id, { plannedStop: '5005' });
      expect(res.statusCode).toBe(400);
      expect(
        (parse(res) as { fieldErrors: Record<string, string[]> }).fieldErrors
          .plannedStop,
      ).toBeDefined();
    });

    it('{} with the form error', async () => {
      const env = makeEnv();
      const h = await open(env);
      const res = await patch(env, 'a', h.id, {});
      expect(res.statusCode).toBe(400);
      expect(parse(res)).toMatchObject({
        message: 'Invalid trade',
        formErrors: ['Body must change at least one field'],
      });
    });

    it.each(['id', 'createdAt', 'updatedAt', 'metrics', 'planedStop'])(
      'unknown key %s',
      async (key) => {
        const env = makeEnv();
        const h = await open(env);
        const res = await patch(env, 'a', h.id, { notes: 'x', [key]: 'x' });
        expect(res.statusCode).toBe(400);
      },
    );

    it('null for a required field', async () => {
      const env = makeEnv();
      const h = await open(env);
      const res = await patch(env, 'a', h.id, { fees: null });
      expect(res.statusCode).toBe(400);
    });

    it('a body that is not JSON', async () => {
      const env = makeEnv();
      const h = await open(env);
      const res = await patch(env, 'a', h.id, 'nope');
      expect(res.statusCode).toBe(400);
      expect(parse(res)).toEqual({ message: 'Body must be valid JSON' });
    });

    it('leaves the stored trade unchanged', async () => {
      const env = makeEnv();
      const h = await open(env);
      await patch(env, 'a', h.id, { plannedStop: '5005' });
      expect(parse(await getTrade(env, 'a', h.id))).toEqual(h);
    });
  });

  it('is 404 for another user and leaves the trade unchanged', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    const res = await patch(env, 'b', a.id, { notes: 'hijack' });
    expect(res.statusCode).toBe(404);
    expect(parse(res)).toEqual({ message: 'Trade not found' });
    expect(parse(await getTrade(env, 'a', a.id))).toEqual(a);
    expect(await listFor(env, 'a')).toEqual([a]);
  });

  it('is 404 for an unknown id', async () => {
    const env = makeEnv();
    const res = await patch(env, 'a', uuid(99), { notes: 'x' });
    expect(res.statusCode).toBe(404);
  });

  it('is 404 for a non-UUID id, even with a bad body', async () => {
    const env = makeEnv();
    const res = await patch(env, 'a', 'nope', 'not json');
    expect(res.statusCode).toBe(404);
    expect(parse(res)).toEqual({ message: 'Trade not found' });
  });

  it('reads with a consistent read', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    const spy = vi.spyOn(env.store, 'get');
    await patch(env, 'a', a.id, { notes: 'x' });
    expect(spy).toHaveBeenCalledWith('a', a.id, { consistent: true });
  });

  describe('races', () => {
    const racing = (error: Error) => {
      const inner: TradeStore = new MemoryTradeStore();
      const store: TradeStore = {
        put: (u, r) => inner.put(u, r),
        get: (u, i, o) => inner.get(u, i, o),
        list: (u, o) => inner.list(u, o),
        delete: (u, i) => inner.delete(u, i),
        replace: () => Promise.reject(error),
      };
      return makeEnv(store);
    };

    it('is 409 when the store reports a conflict', async () => {
      const env = racing(new TradeConflictError('x'));
      const a = await create(env, 'a', exampleA);
      const res = await patch(env, 'a', a.id, { notes: 'x' });
      expect(res.statusCode).toBe(409);
      expect(parse(res)).toEqual({ message: 'Trade changed while saving' });
    });

    it('is 404 when the trade vanished between read and write', async () => {
      const env = racing(new TradeNotFoundError('x'));
      const a = await create(env, 'a', exampleA);
      const res = await patch(env, 'a', a.id, { notes: 'x' });
      expect(res.statusCode).toBe(404);
      expect(parse(res)).toEqual({ message: 'Trade not found' });
    });

    it('moves updatedAt on when the clock has not moved, so a stale write still fails', async () => {
      const env = makeEnv();
      const a = await create(env, 'a', exampleA);
      // Read by a second writer before the first one saves.
      const stale = await env.store.get('a', a.id);
      if (!stale) throw new Error('missing');
      // Same clock as the create: without the bump updatedAt wouldn't change.
      const first = TradeViewSchema.parse(
        parse(await patch(env, 'a', a.id, { notes: 'first' })),
      );
      expect(first.updatedAt).toBe('2026-11-19T12:00:00.001Z');
      await expect(
        env.store.replace('a', stale, stale.updatedAt),
      ).rejects.toBeInstanceOf(TradeConflictError);
      // A clock behind the stored value is bumped too.
      env.setNow('2026-11-19T11:00:00.000Z');
      const second = TradeViewSchema.parse(
        parse(await patch(env, 'a', a.id, { notes: 'second' })),
      );
      expect(second.updatedAt).toBe('2026-11-19T12:00:00.002Z');
    });

    it('memory store rejects a stale write', async () => {
      const env = makeEnv();
      const a = await create(env, 'a', exampleA);
      const stored = await env.store.get('a', a.id);
      if (!stored) throw new Error('missing');
      await expect(
        env.store.replace('a', stored, '2000-01-01T00:00:00.000Z'),
      ).rejects.toBeInstanceOf(TradeConflictError);
      await expect(
        env.store.replace('b', stored, stored.updatedAt),
      ).rejects.toBeInstanceOf(TradeNotFoundError);
    });
  });

  it('is 500 without leaking detail', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    vi.spyOn(env.store, 'replace').mockRejectedValue(new Error('SECRET'));
    const res = await patch(env, 'a', a.id, { notes: 'x' });
    expect(res.statusCode).toBe(500);
    expect(parse(res)).toEqual({ message: 'Internal error' });
    expect(res.body).not.toContain('SECRET');
  });
});

describe('DELETE /trades/{id}', () => {
  const del = (env: Env, sub: string, id: string) =>
    env.del(as(sub, { pathParameters: { id } })) as Promise<Res>;

  it('is 204 with no body or content-type, then 404 on get and a second delete', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    const res = await del(env, 'a', a.id);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.headers).not.toHaveProperty('content-type');
    expect((await getTrade(env, 'a', a.id)).statusCode).toBe(404);
    expect(await listFor(env, 'a')).toEqual([]);
    const again = await del(env, 'a', a.id);
    expect(again.statusCode).toBe(404);
    expect(parse(again)).toEqual({ message: 'Trade not found' });
  });

  it('is 404 for another user and keeps the trade', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    expect((await del(env, 'b', a.id)).statusCode).toBe(404);
    expect(parse(await getTrade(env, 'a', a.id))).toEqual(a);
    expect(await listFor(env, 'a')).toEqual([a]);
  });

  it('is 404 for a non-UUID id', async () => {
    const env = makeEnv();
    expect((await del(env, 'a', 'nope')).statusCode).toBe(404);
  });

  it('accepts an upper-cased id', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    expect((await del(env, 'a', a.id.toUpperCase())).statusCode).toBe(204);
  });

  it('is 500 without leaking detail', async () => {
    const env = makeEnv();
    vi.spyOn(env.store, 'delete').mockRejectedValue(new Error('SECRET'));
    const res = await del(env, 'a', uuid(1));
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('SECRET');
  });
});

describe('401 for update and delete', () => {
  const cases: [string, Event][] = [
    ['an ID token', claims({ sub: 'u', token_use: 'id' })],
    [
      'missing token_use',
      {
        requestContext: { authorizer: { jwt: { claims: { sub: 'u' } } } },
      } as unknown as Event,
    ],
    ['a missing authorizer', { requestContext: {} } as unknown as Event],
    ['no sub', claims({ client_id: 'abc' })],
    ['an empty sub', claims({ sub: '' })],
    ['a non-string sub', claims({ sub: 42 })],
  ];

  describe.each(cases)('%s', (_name, ev) => {
    const withExtras = { pathParameters: { id: uuid(1) }, body: '{}' };
    it.each([
      ['update-trade', (env: Env) => env.update({ ...ev, ...withExtras })],
      ['delete-trade', (env: Env) => env.del({ ...ev, ...withExtras })],
    ])('%s returns 401', async (_h, call) => {
      const res = (await call(makeEnv())) as Res;
      expect(res.statusCode).toBe(401);
      expect(parse(res)).toEqual({ message: 'Unauthorized' });
    });
  });
});

describe('update after delete', () => {
  it('is 404 for PATCH on a deleted trade', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    await env.del(as('a', { pathParameters: { id: a.id } }));
    const res = await patch(env, 'a', a.id, { notes: 'x' });
    expect(res.statusCode).toBe(404);
    expect(parse(res)).toEqual({ message: 'Trade not found' });
  });

  it('keeps user A trade intact when B deletes it, and B can still delete their own', async () => {
    const env = makeEnv();
    const a = await create(env, 'a', exampleA);
    const b = await create(env, 'b', exampleA);
    await env.del(as('b', { pathParameters: { id: a.id } }));
    expect(await listFor(env, 'a')).toEqual([a]);
    const res = (await env.del(
      as('b', { pathParameters: { id: b.id } }),
    )) as Res;
    expect(res.statusCode).toBe(204);
  });
});
