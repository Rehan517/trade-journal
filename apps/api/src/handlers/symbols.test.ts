import {
  ListSymbolsResponseSchema,
  SymbolSettingSchema,
} from '@trade-journal/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySymbolStore } from '../lib/memory-symbol-store.js';
import type { SymbolStore } from '../lib/symbol-store.js';
import { makeHandler as makeDelete } from './delete-symbol.js';
import { makeHandler as makeList } from './list-symbols.js';
import { makeHandler as makePut } from './put-symbol.js';

type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
type Res = {
  statusCode?: number;
  headers?: Record<string, unknown>;
  body?: string;
};

const withClaims = (
  claims: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  ({
    requestContext: {
      authorizer: { jwt: { claims, scopes: [] } },
    },
    ...extra,
  }) as unknown as Event;
const as = (sub: string, extra: Record<string, unknown> = {}) =>
  withClaims({ sub, token_use: 'access' }, extra);

const makeEnv = (store: SymbolStore = new MemorySymbolStore()) => {
  let clock = new Date('2026-11-19T12:00:00.000Z');
  const deps = { store, now: () => clock };
  const list = makeList(deps);
  const put = makePut(deps);
  const del = makeDelete(deps);
  return {
    setNow: (iso: string) => {
      clock = new Date(iso);
    },
    list: (sub: string) => list(as(sub)) as Promise<Res>,
    put: (sub: string, root: string, body: unknown) =>
      put(
        as(sub, {
          pathParameters: { root },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }),
      ) as Promise<Res>,
    del: (sub: string, root: string) =>
      del(as(sub, { pathParameters: { root } })) as Promise<Res>,
    raw: { list, put, del },
  };
};

const parse = (res: Res) => JSON.parse(res.body ?? '') as unknown;
const listFor = async (env: ReturnType<typeof makeEnv>, sub: string) =>
  ListSymbolsResponseSchema.parse(parse(await env.list(sub))).items;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('symbols handlers', () => {
  it('PUT then GET returns the value; a second PUT replaces it', async () => {
    const env = makeEnv();
    const res = await env.put('a', 'MES', { pointValue: '5' });
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    expect(SymbolSettingSchema.parse(parse(res))).toEqual({
      root: 'MES',
      pointValue: '5',
      updatedAt: '2026-11-19T12:00:00.000Z',
    });
    expect(await listFor(env, 'a')).toHaveLength(1);

    env.setNow('2026-11-20T00:00:00.000Z');
    await env.put('a', 'MES', { pointValue: '6' });
    expect(await listFor(env, 'a')).toEqual([
      { root: 'MES', pointValue: '6', updatedAt: '2026-11-20T00:00:00.000Z' },
    ]);
  });

  it('uppercases the path root', async () => {
    const env = makeEnv();
    const res = await env.put('a', 'mes', { pointValue: '5' });
    expect(res.statusCode).toBe(200);
    expect((await listFor(env, 'a'))[0]?.root).toBe('MES');
    expect((await env.del('a', 'mes')).statusCode).toBe(204);
  });

  it('GET is sorted by root and has no defaults', async () => {
    const env = makeEnv();
    expect(await listFor(env, 'a')).toEqual([]);
    await env.put('a', 'NQ', { pointValue: '25' });
    await env.put('a', 'M2K', { pointValue: '5' });
    await env.put('a', 'ES', { pointValue: '50' });
    const res = await env.list('a');
    expect(res.statusCode).toBe(200);
    expect((await listFor(env, 'a')).map((s) => s.root)).toEqual([
      'ES',
      'M2K',
      'NQ',
    ]);
  });

  it('DELETE is 204 with no body, then gone, then 404', async () => {
    const env = makeEnv();
    await env.put('a', 'MES', { pointValue: '5' });
    const res = await env.del('a', 'MES');
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeUndefined();
    expect(await listFor(env, 'a')).toEqual([]);
    const again = await env.del('a', 'MES');
    expect(again.statusCode).toBe(404);
    expect(parse(again)).toEqual({ message: 'Setting not found' });
  });

  it('DELETE of an invalid root is 404', async () => {
    const env = makeEnv();
    for (const root of ['MESZ6', 'BRK.B']) {
      const res = await env.del('a', root);
      expect(res.statusCode).toBe(404);
      expect(parse(res)).toEqual({ message: 'Setting not found' });
    }
  });

  it("keeps users' settings apart", async () => {
    const env = makeEnv();
    await env.put('a', 'MES', { pointValue: '5' });
    expect(await listFor(env, 'b')).toEqual([]);
    expect((await env.del('b', 'MES')).statusCode).toBe(404);
    expect(await listFor(env, 'a')).toHaveLength(1);
    await env.put('b', 'MES', { pointValue: '7' });
    expect((await listFor(env, 'a'))[0]?.pointValue).toBe('5');
  });

  describe('PUT validation', () => {
    it.each(['MESZ6', 'BRK.B', 'MES1!'])('rejects root %s', async (root) => {
      const res = await makeEnv().put('a', root, { pointValue: '5' });
      expect(res.statusCode).toBe(400);
      expect(parse(res)).toEqual({ message: 'Invalid root' });
    });

    it('checks the root before the body', async () => {
      const res = await makeEnv().put('a', 'MESZ6', 'not json');
      expect(parse(res)).toEqual({ message: 'Invalid root' });
    });

    it.each([
      { pointValue: '-5' },
      { pointValue: '5e1' },
      { pointValue: '0' },
      { pointValue: 5 },
      { pointValue: '5', extra: true },
      {},
    ])('rejects body %j', async (body) => {
      const res = await makeEnv().put('a', 'MES', body);
      expect(res.statusCode).toBe(400);
      const out = parse(res) as Record<string, unknown>;
      expect(out.message).toBe('Invalid setting');
      expect(out).toHaveProperty('fieldErrors');
      expect(out).toHaveProperty('formErrors');
    });

    it('rejects a body that is not JSON', async () => {
      const res = await makeEnv().put('a', 'MES', 'nope');
      expect(res.statusCode).toBe(400);
      expect(parse(res)).toEqual({ message: 'Body must be valid JSON' });
    });
  });

  describe('401', () => {
    const bad = [
      ['no authorizer', {}],
      ['ID token', { sub: 'a', token_use: 'id' }],
      ['no token_use', { sub: 'a' }],
      ['no sub', { token_use: 'access' }],
      ['empty sub', { sub: '', token_use: 'access' }],
    ] as const;
    it.each(bad)('on every route: %s', async (name, claims) => {
      const env = makeEnv();
      const event = (extra: Record<string, unknown> = {}) =>
        name === 'no authorizer'
          ? ({ requestContext: {}, ...extra } as unknown as Event)
          : withClaims(claims, extra);
      const extra = {
        pathParameters: { root: 'MES' },
        body: '{"pointValue":"5"}',
      };
      for (const res of [
        await env.raw.list(event()),
        await env.raw.put(event(extra)),
        await env.raw.del(event(extra)),
      ]) {
        expect((res as Res).statusCode).toBe(401);
        expect(parse(res as Res)).toEqual({ message: 'Unauthorized' });
      }
    });
  });

  it('returns 500 on a store failure', async () => {
    const boom = () => Promise.reject(new Error('boom'));
    const env = makeEnv({ list: boom, put: boom, delete: boom });
    for (const res of [
      await env.list('a'),
      await env.put('a', 'MES', { pointValue: '5' }),
      await env.del('a', 'MES'),
    ]) {
      expect(res.statusCode).toBe(500);
      expect(parse(res)).toEqual({ message: 'Internal error' });
    }
  });
});
