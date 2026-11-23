import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Trade } from '@trade-journal/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CorruptItemError,
  DynamoTradeStore,
  decodeCursor,
  InvalidCursorError,
  encodeCursor,
  openedAtKey,
  paddedBound,
  type TradeRecord,
} from './trade-store.js';

const ddb = mockClient(DynamoDBDocumentClient);
const TABLE = 'TradesTable';
const ID = '00000000-0000-4000-8000-000000000001';

const trade: Trade = {
  id: ID,
  symbol: 'MES',
  instrumentType: 'future',
  side: 'long',
  quantity: '2',
  pointValue: '5',
  entryPrice: '5000',
  exitPrice: '5010',
  openedAt: '2026-11-19T01:30:00.5Z',
  closedAt: '2026-11-19T02:00:00Z',
  fees: '1.24',
  plannedStop: '4995',
} as Trade;

const record: TradeRecord = {
  trade,
  createdAt: '2026-11-19T12:00:00.000Z',
  updatedAt: '2026-11-19T12:00:00.000Z',
};

const store = () => new DynamoTradeStore(() => TABLE, { region: 'eu-west-2' });

const storedItem = (userId = 'a') => ({
  ...trade,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  pk: `USER#${userId}`,
  sk: `TRADE#${ID}`,
  openedAtKey: openedAtKey(trade.openedAt, ID),
});

beforeEach(() => {
  ddb.reset();
});
afterEach(() => {
  ddb.reset();
});

describe('openedAtKey', () => {
  it('pads the fraction to 9 digits', () => {
    expect(openedAtKey('2026-11-19T01:30:00Z', ID)).toBe(
      `2026-11-19T01:30:00.000000000Z#${ID}`,
    );
    expect(openedAtKey('2026-11-19T01:30:00.5Z', ID)).toBe(
      `2026-11-19T01:30:00.500000000Z#${ID}`,
    );
  });

  it('sorts as string in time order', () => {
    expect(
      openedAtKey('2026-11-19T01:30:00.5Z', ID) >
        openedAtKey('2026-11-19T01:30:00Z', ID),
    ).toBe(true);
  });
});

describe('cursor', () => {
  it('round trips', () => {
    const key = {
      sk: `TRADE#${ID}`,
      openedAtKey: openedAtKey(trade.openedAt, ID),
    };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it('rejects garbage', () => {
    expect(decodeCursor('%%%')).toBeUndefined();
    expect(
      decodeCursor(
        Buffer.from('{"pk":"USER#b","sk":"a","openedAtKey":"b"}').toString(
          'base64url',
        ),
      ),
    ).toBeUndefined();
  });
});

describe('DynamoTradeStore.put', () => {
  it('sends a conditional PutItem with the right keys and string decimals', async () => {
    ddb.on(PutCommand).resolves({});
    await store().put('a', record);

    const calls = ddb.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]?.args[0].input;
    expect(input?.TableName).toBe(TABLE);
    expect(input?.ConditionExpression).toBe('attribute_not_exists(sk)');
    expect(input?.Item).toMatchObject({
      pk: 'USER#a',
      sk: `TRADE#${ID}`,
      openedAtKey: `2026-11-19T01:30:00.500000000Z#${ID}`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
    for (const f of [
      'quantity',
      'pointValue',
      'entryPrice',
      'exitPrice',
      'fees',
      'plannedStop',
    ]) {
      expect(typeof input?.Item?.[f]).toBe('string');
    }
    expect(input?.Item?.fees).toBe('1.24');
  });

  it('does not store metrics', async () => {
    ddb.on(PutCommand).resolves({});
    await store().put('a', record);
    const item = ddb.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(item).not.toHaveProperty('metrics');
  });

  it('uses the caller as pk for different users', async () => {
    ddb.on(PutCommand).resolves({});
    await store().put('b', record);
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item?.pk).toBe(
      'USER#b',
    );
  });

  it('propagates a conditional check failure', async () => {
    ddb.on(PutCommand).rejects(new Error('ConditionalCheckFailedException'));
    await expect(store().put('a', record)).rejects.toThrow();
  });
});

describe('DynamoTradeStore.get', () => {
  it('uses the caller pk and the trade sk', async () => {
    ddb.on(GetCommand).resolves({ Item: storedItem('a') });
    const res = await store().get('a', ID);
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input).toMatchObject({
      TableName: TABLE,
      Key: { pk: 'USER#a', sk: `TRADE#${ID}` },
    });
    expect(res?.trade).toEqual(trade);
    expect(res?.createdAt).toBe(record.createdAt);
  });

  it('returns undefined when there is no item', async () => {
    ddb.on(GetCommand).resolves({});
    expect(await store().get('b', ID)).toBeUndefined();
    expect(ddb.commandCalls(GetCommand)[0]?.args[0].input.Key?.pk).toBe(
      'USER#b',
    );
  });

  it('throws CorruptItemError for an item that fails parsing', async () => {
    ddb
      .on(GetCommand)
      .resolves({ Item: { ...storedItem(), side: 'sideways' } });
    await expect(store().get('a', ID)).rejects.toBeInstanceOf(CorruptItemError);
  });

  it('throws CorruptItemError for bad timestamps', async () => {
    ddb
      .on(GetCommand)
      .resolves({ Item: { ...storedItem(), createdAt: 'yesterday' } });
    await expect(store().get('a', ID)).rejects.toBeInstanceOf(CorruptItemError);
  });
});

describe('DynamoTradeStore.list', () => {
  it('queries byOpenedAt newest first for the caller', async () => {
    ddb.on(QueryCommand).resolves({ Items: [storedItem('a')] });
    const res = await store().list('a', { limit: 10 });
    const input = ddb.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      TableName: TABLE,
      IndexName: 'byOpenedAt',
      ScanIndexForward: false,
      Limit: 10,
      ExpressionAttributeValues: { ':pk': 'USER#a' },
    });
    expect(input?.KeyConditionExpression).toContain('pk = :pk');
    expect(input?.ExclusiveStartKey).toBeUndefined();
    expect(res.items).toHaveLength(1);
    expect(res.lastKey).toBeUndefined();
  });

  it('uses the caller pk in ExclusiveStartKey from a cursor', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const startKey = {
      sk: `TRADE#${ID}`,
      openedAtKey: openedAtKey(trade.openedAt, ID),
    };
    await store().list('b', { limit: 5, startKey });
    const input = ddb.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(input?.ExclusiveStartKey).toEqual({ pk: 'USER#b', ...startKey });
    expect(input?.ExpressionAttributeValues?.[':pk']).toBe('USER#b');
  });

  it('cannot be pointed at another user via a cursor containing pk', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const evil = { pk: 'USER#victim', sk: 'TRADE#x', openedAtKey: 'k' };
    await store().list('b', { limit: 5, startKey: evil });
    expect(
      ddb.commandCalls(QueryCommand)[0]?.args[0].input.ExclusiveStartKey?.pk,
    ).toBe('USER#b');
  });

  it('returns lastKey (without pk) from LastEvaluatedKey', async () => {
    const item = storedItem('a');
    ddb.on(QueryCommand).resolves({
      Items: [item],
      LastEvaluatedKey: {
        pk: 'USER#a',
        sk: item.sk,
        openedAtKey: item.openedAtKey,
      },
    });
    const res = await store().list('a', { limit: 1 });
    expect(res.lastKey).toEqual({ sk: item.sk, openedAtKey: item.openedAtKey });
  });

  it('fails when a listed item is corrupt', async () => {
    ddb
      .on(QueryCommand)
      .resolves({ Items: [{ ...storedItem(), quantity: 2 }] });
    await expect(store().list('a', { limit: 5 })).rejects.toBeInstanceOf(
      CorruptItemError,
    );
  });
});

describe('paddedBound', () => {
  it('pads like openedAtKey without the id suffix', () => {
    expect(paddedBound('2026-11-01T04:00:00Z')).toBe(
      '2026-11-01T04:00:00.000000000Z',
    );
    expect(paddedBound('2026-11-01T04:00:00.5Z')).toBe(
      '2026-11-01T04:00:00.500000000Z',
    );
    expect(paddedBound('2026-12-01T05:00:00.000Z')).toBe(
      '2026-12-01T05:00:00.000000000Z',
    );
  });
  it('sorts before every key at the same instant', () => {
    expect(
      paddedBound('2026-11-01T04:00:00Z') <
        openedAtKey('2026-11-01T04:00:00Z', ID),
    ).toBe(true);
  });
});

describe('DynamoTradeStore.list date range', () => {
  const FROM = '2026-11-01T04:00:00.000Z';
  const TO = '2026-12-01T05:00:00.500Z';
  const sent = () => ddb.commandCalls(QueryCommand)[0]?.args[0].input;

  it('without a range uses only the pk condition and no :from or :to', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await store().list('a', { limit: 5 });
    expect(sent()?.KeyConditionExpression).toBe('pk = :pk');
    expect(sent()?.ExpressionAttributeValues).toEqual({ ':pk': 'USER#a' });
  });

  it('from alone uses >= with a padded bound', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await store().list('a', { limit: 5, from: FROM });
    expect(sent()?.KeyConditionExpression).toBe(
      'pk = :pk AND openedAtKey >= :from',
    );
    expect(sent()?.ExpressionAttributeValues).toEqual({
      ':pk': 'USER#a',
      ':from': '2026-11-01T04:00:00.000000000Z',
    });
  });

  it('to alone uses < with a padded bound', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await store().list('a', { limit: 5, to: TO });
    expect(sent()?.KeyConditionExpression).toBe(
      'pk = :pk AND openedAtKey < :to',
    );
    expect(sent()?.ExpressionAttributeValues).toEqual({
      ':pk': 'USER#a',
      ':to': '2026-12-01T05:00:00.500000000Z',
    });
  });

  it('both use BETWEEN with two padded bounds', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await store().list('a', { limit: 5, from: FROM, to: TO });
    expect(sent()?.KeyConditionExpression).toBe(
      'pk = :pk AND openedAtKey BETWEEN :from AND :to',
    );
    expect(sent()?.ExpressionAttributeValues).toEqual({
      ':pk': 'USER#a',
      ':from': '2026-11-01T04:00:00.000000000Z',
      ':to': '2026-12-01T05:00:00.500000000Z',
    });
    expect(sent()).toMatchObject({
      IndexName: 'byOpenedAt',
      ScanIndexForward: false,
    });
    expect(sent()).not.toHaveProperty('FilterExpression');
  });

  const startKey = {
    sk: `TRADE#${ID}`,
    openedAtKey: openedAtKey(trade.openedAt, ID),
  };
  const validation = () =>
    Object.assign(
      new Error(
        'The provided starting key is outside query boundaries based on provided conditions',
      ),
      { name: 'ValidationException' },
    );

  it.each([
    ['from alone', { from: '2026-11-20T00:00:00Z' }],
    ['to alone', { to: '2026-11-19T00:00:00Z' }],
    ['both', { from: '2026-11-20T00:00:00Z', to: '2026-11-30T00:00:00Z' }],
  ])(
    'rejects a start key outside the range before querying (%s)',
    async (_, range) => {
      ddb.on(QueryCommand).resolves({ Items: [] });
      await expect(
        store().list('a', { limit: 5, startKey, ...range }),
      ).rejects.toBeInstanceOf(InvalidCursorError);
      expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
    },
  );

  it('queries with a start key inside the range', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await store().list('a', { limit: 5, startKey, from: FROM, to: TO });
    expect(sent()?.ExclusiveStartKey).toEqual({ ...startKey, pk: 'USER#a' });
  });

  it('maps a starting-key ValidationException with a startKey to InvalidCursorError', async () => {
    ddb.on(QueryCommand).rejects(validation());
    await expect(
      store().list('a', { limit: 5, startKey, from: FROM }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('propagates the same exception unchanged without a startKey', async () => {
    const err = validation();
    ddb.on(QueryCommand).rejects(err);
    await expect(store().list('a', { limit: 5, from: FROM })).rejects.toBe(err);
  });

  it('propagates an unrelated error unchanged even with a startKey', async () => {
    const err = Object.assign(new Error('boom'), {
      name: 'InternalServerError',
    });
    ddb.on(QueryCommand).rejects(err);
    await expect(
      store().list('a', { limit: 5, startKey, from: FROM }),
    ).rejects.toBe(err);
  });

  it('propagates a different ValidationException even with a startKey', async () => {
    const err = Object.assign(new Error('Invalid KeyConditionExpression'), {
      name: 'ValidationException',
    });
    ddb.on(QueryCommand).rejects(err);
    await expect(
      store().list('a', { limit: 5, startKey, from: FROM }),
    ).rejects.toBe(err);
  });
});

describe('DynamoTradeStore setup', () => {
  it('throws when TABLE_NAME is not set', async () => {
    const prev = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;
    try {
      await expect(new DynamoTradeStore().get('a', ID)).rejects.toThrow();
    } finally {
      if (prev !== undefined) process.env.TABLE_NAME = prev;
    }
  });
});

describe('decodeCursor key shapes', () => {
  const good = {
    sk: `TRADE#${ID}`,
    openedAtKey: openedAtKey('2026-11-19T01:30:00Z', ID),
  };

  it('round-trips a key this server writes', () => {
    expect(decodeCursor(encodeCursor(good))).toEqual(good);
  });

  it.each([
    ['an sk that is not TRADE#<uuid>', { ...good, sk: 'USER#b' }],
    [
      'an openedAtKey over the DynamoDB sort-key limit',
      { ...good, openedAtKey: `${'9'.repeat(2000)}#${ID}` },
    ],
    [
      'an unpadded openedAtKey',
      { ...good, openedAtKey: `2026-11-19T01:30:00Z#${ID}` },
    ],
  ])('rejects %s', (_name, key) => {
    expect(decodeCursor(encodeCursor(key))).toBeUndefined();
  });
});
