import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DynamoSymbolStore } from './symbol-store.js';
import { CorruptItemError } from './trade-store.js';

const ddb = mockClient(DynamoDBDocumentClient);
const TABLE = 'SymbolsTable';
const store = () => new DynamoSymbolStore(() => TABLE, { region: 'eu-west-2' });

const item = (root: string, pointValue = '5') => ({
  pk: 'USER#a',
  sk: `SYMBOL#${root}`,
  root,
  pointValue,
  updatedAt: '2026-11-19T12:00:00.000Z',
});

beforeEach(() => {
  ddb.reset();
});
afterEach(() => {
  ddb.reset();
});

describe('DynamoSymbolStore.list', () => {
  it('queries the caller pk consistently and follows LastEvaluatedKey', async () => {
    const key = { pk: 'USER#a', sk: 'SYMBOL#NQ' };
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [item('NQ', '20')], LastEvaluatedKey: key })
      .resolvesOnce({ Items: [item('ES', '50')] });
    const result = await store().list('a');

    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    const first = calls[0]?.args[0].input;
    expect(first?.TableName).toBe(TABLE);
    expect(first?.KeyConditionExpression).toBe('pk = :pk');
    expect(first?.ExpressionAttributeValues).toEqual({ ':pk': 'USER#a' });
    expect(first?.ConsistentRead).toBe(true);
    expect(first?.ExclusiveStartKey).toBeUndefined();
    const second = calls[1]?.args[0].input;
    expect(second?.ExclusiveStartKey).toEqual(key);
    expect(second?.ConsistentRead).toBe(true);
    expect(result.map((s) => s.root)).toEqual(['ES', 'NQ']);
    expect(result[0]).toEqual({
      root: 'ES',
      pointValue: '50',
      updatedAt: '2026-11-19T12:00:00.000Z',
    });
  });

  it('returns an empty list', async () => {
    ddb.on(QueryCommand).resolves({});
    expect(await store().list('a')).toEqual([]);
  });

  it('throws CorruptItemError for an item that fails parsing', async () => {
    ddb.on(QueryCommand).resolves({ Items: [item('MES', '-5')] });
    await expect(store().list('a')).rejects.toBeInstanceOf(CorruptItemError);
  });
});

describe('DynamoSymbolStore.put', () => {
  it('sends an unconditional PutItem with a string point value', async () => {
    ddb.on(PutCommand).resolves({});
    await store().put('a', {
      root: 'MYM',
      pointValue: '0.5',
      updatedAt: '2026-11-19T12:00:00.000Z',
    });
    const input = ddb.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.TableName).toBe(TABLE);
    expect(input?.ConditionExpression).toBeUndefined();
    expect(input?.Item).toEqual({
      pk: 'USER#a',
      sk: 'SYMBOL#MYM',
      root: 'MYM',
      pointValue: '0.5',
      updatedAt: '2026-11-19T12:00:00.000Z',
    });
    expect(typeof input?.Item?.pointValue).toBe('string');
  });
});

describe('DynamoSymbolStore.delete', () => {
  it('deletes conditionally on attribute_exists(sk)', async () => {
    ddb.on(DeleteCommand).resolves({});
    expect(await store().delete('a', 'MES')).toBe(true);
    const input = ddb.commandCalls(DeleteCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual({ pk: 'USER#a', sk: 'SYMBOL#MES' });
    expect(input?.ConditionExpression).toBe('attribute_exists(sk)');
  });

  it('returns false when the condition fails', async () => {
    ddb.on(DeleteCommand).rejects(
      new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      }),
    );
    expect(await store().delete('a', 'MES')).toBe(false);
  });

  it('rethrows other errors', async () => {
    ddb.on(DeleteCommand).rejects(new Error('boom'));
    await expect(store().delete('a', 'MES')).rejects.toThrow('boom');
  });
});
