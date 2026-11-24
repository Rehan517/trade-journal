import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TradeSchema, type Trade } from '@trade-journal/shared';
import { z } from 'zod';

/** A stored trade with its server-set timestamps. */
export type TradeRecord = {
  trade: Trade;
  createdAt: string;
  updatedAt: string;
};

/** Position of the last item returned; the caller's pk is added server-side. */
export const ListKeySchema = z.object({
  sk: z.string().min(1),
  openedAtKey: z.string().min(1),
});
export type ListKey = z.infer<typeof ListKeySchema>;

export type ListResult = { items: TradeRecord[]; lastKey?: ListKey };

export interface TradeStore {
  /** Fails if the trade already exists. */
  put(userId: string, record: TradeRecord): Promise<void>;
  /** `consistent` asks for a strongly consistent read (the PATCH path). */
  get(
    userId: string,
    id: string,
    options?: { consistent?: boolean },
  ): Promise<TradeRecord | undefined>;
  /**
   * Overwrites a stored trade, only if it still exists and its `updatedAt`
   * equals `expectedUpdatedAt`. Throws `TradeNotFoundError` when it's gone
   * and `TradeConflictError` when it changed.
   */
  replace(
    userId: string,
    record: TradeRecord,
    expectedUpdatedAt: string,
  ): Promise<void>;
  /** Returns false when there was nothing to delete. */
  delete(userId: string, id: string): Promise<boolean>;
  /** Newest `openedAt` first. */
  list(
    userId: string,
    options: { limit: number; startKey?: ListKey; from?: string; to?: string },
  ): Promise<ListResult>;
}

/** A stored item that doesn't parse. A server bug, not a user error. */
export class CorruptItemError extends Error {}

/** `replace` found no trade to replace. */
export class TradeNotFoundError extends Error {}

/** `replace` found the trade changed since it was read. */
export class TradeConflictError extends Error {}

/** The cursor is outside the requested date range. A client error. */
export class InvalidCursorError extends Error {}

export const userPk = (userId: string) => `USER#${userId}`;
export const tradeSk = (id: string) => `TRADE#${id}`;

/**
 * `openedAt` with the fraction padded to 9 digits, then `#<id>`, so string
 * order matches time order and ties break by id.
 */
export function openedAtKey(openedAt: string, id: string): string {
  return `${paddedBound(openedAt)}#${id}`;
}

/** `openedAtKey` padding without the `#<id>` suffix, for range bounds. */
export function paddedBound(openedAt: string): string {
  const [base = '', fraction = ''] = openedAt.slice(0, -1).split('.');
  return `${base}.${fraction.padEnd(9, '0').slice(0, 9)}Z`;
}

/**
 * Whether an `openedAtKey` is in [from, to). The key condition's rule, used
 * by both stores to check a cursor before querying.
 */
export function inDateRange(key: string, from?: string, to?: string): boolean {
  return (
    (from === undefined || key >= paddedBound(from)) &&
    (to === undefined || key < paddedBound(to))
  );
}

export function encodeCursor(key: ListKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * A cursor holds exactly the key shapes this server writes, so a tampered
 * one is a 400 here rather than a DynamoDB ValidationException (500) later.
 */
const CursorSchema = z
  .object({
    sk: z.string().regex(new RegExp(`^TRADE#${UUID}$`)),
    openedAtKey: z
      .string()
      .regex(
        new RegExp(
          `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{9}Z#${UUID}$`,
        ),
      ),
  })
  .strict();

/** Returns undefined for anything that isn't a cursor this server made. */
export function decodeCursor(cursor: string): ListKey | undefined {
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    const parsed = CursorSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const IsoDateTimeSchema = z.iso.datetime();

/** Parse a stored item (or a record's parts) back into a `TradeRecord`. */
export function parseRecord(item: unknown): TradeRecord {
  const trade = TradeSchema.safeParse(item);
  const stamps = z
    .object({ createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema })
    .safeParse(item);
  if (!trade.success || !stamps.success) {
    throw new CorruptItemError('Stored trade failed parsing');
  }
  return { trade: trade.data, ...stamps.data };
}

function isConditionFailure(err: unknown): boolean {
  return (
    err instanceof ConditionalCheckFailedException ||
    (err instanceof Error && err.name === 'ConditionalCheckFailedException')
  );
}

export class DynamoTradeStore implements TradeStore {
  private doc: DynamoDBDocumentClient | undefined;

  constructor(
    private readonly tableName: () => string = () => {
      const name = process.env.TABLE_NAME;
      if (!name) throw new Error('TABLE_NAME is not set');
      return name;
    },
    private readonly clientConfig: DynamoDBClientConfig = {},
  ) {}

  // Created on first use so importing a handler needs no AWS setup.
  private client(): DynamoDBDocumentClient {
    this.doc ??= DynamoDBDocumentClient.from(
      new DynamoDBClient(this.clientConfig),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    return this.doc;
  }

  async put(userId: string, record: TradeRecord): Promise<void> {
    const { trade, createdAt, updatedAt } = record;
    await this.client().send(
      new PutCommand({
        TableName: this.tableName(),
        Item: {
          ...trade,
          createdAt,
          updatedAt,
          pk: userPk(userId),
          sk: tradeSk(trade.id),
          openedAtKey: openedAtKey(trade.openedAt, trade.id),
        },
        ConditionExpression: 'attribute_not_exists(sk)',
      }),
    );
  }

  async get(
    userId: string,
    id: string,
    options: { consistent?: boolean } = {},
  ): Promise<TradeRecord | undefined> {
    const res = await this.client().send(
      new GetCommand({
        TableName: this.tableName(),
        Key: { pk: userPk(userId), sk: tradeSk(id) },
        ...(options.consistent ? { ConsistentRead: true } : {}),
      }),
    );
    return res.Item === undefined ? undefined : parseRecord(res.Item);
  }

  async replace(
    userId: string,
    record: TradeRecord,
    expectedUpdatedAt: string,
  ): Promise<void> {
    const { trade, createdAt, updatedAt } = record;
    try {
      await this.client().send(
        new PutCommand({
          TableName: this.tableName(),
          Item: {
            ...trade,
            createdAt,
            updatedAt,
            pk: userPk(userId),
            sk: tradeSk(trade.id),
            openedAtKey: openedAtKey(trade.openedAt, trade.id),
          },
          ConditionExpression:
            'attribute_exists(sk) AND updatedAt = :readUpdatedAt',
          ExpressionAttributeValues: { ':readUpdatedAt': expectedUpdatedAt },
        }),
      );
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
      // Gone, or changed? Read once more to tell them apart.
      const now = await this.get(userId, trade.id, { consistent: true });
      if (!now) throw new TradeNotFoundError('Trade not found');
      throw new TradeConflictError('Trade changed while saving');
    }
  }

  async delete(userId: string, id: string): Promise<boolean> {
    try {
      await this.client().send(
        new DeleteCommand({
          TableName: this.tableName(),
          Key: { pk: userPk(userId), sk: tradeSk(id) },
          ConditionExpression: 'attribute_exists(sk)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionFailure(err)) return false;
      throw err;
    }
  }

  async list(
    userId: string,
    options: { limit: number; startKey?: ListKey; from?: string; to?: string },
  ): Promise<ListResult> {
    const pk = userPk(userId);
    const { from, to } = options;
    // Checked here so the 400 doesn't depend on DynamoDB's error wording.
    if (
      options.startKey &&
      !inDateRange(options.startKey.openedAtKey, from, to)
    ) {
      throw new InvalidCursorError('cursor is outside the date range');
    }
    const values: Record<string, string> = { ':pk': pk };
    let condition = 'pk = :pk';
    if (from !== undefined && to !== undefined) {
      condition += ' AND openedAtKey BETWEEN :from AND :to';
    } else if (from !== undefined) {
      condition += ' AND openedAtKey >= :from';
    } else if (to !== undefined) {
      condition += ' AND openedAtKey < :to';
    }
    if (from !== undefined) values[':from'] = paddedBound(from);
    if (to !== undefined) values[':to'] = paddedBound(to);
    let res;
    try {
      res = await this.client().send(
        new QueryCommand({
          TableName: this.tableName(),
          IndexName: 'byOpenedAt',
          KeyConditionExpression: condition,
          ExpressionAttributeValues: values,
          ScanIndexForward: false,
          Limit: options.limit,
          ConsistentRead: true,
          ExclusiveStartKey: options.startKey && { ...options.startKey, pk },
        }),
      );
    } catch (err) {
      // Fallback for a start key DynamoDB rejects for another reason.
      if (
        options.startKey &&
        err instanceof Error &&
        err.name === 'ValidationException' &&
        /starting key/i.test(err.message)
      ) {
        throw new InvalidCursorError('cursor is outside the date range');
      }
      throw err;
    }
    const items = (res.Items ?? []).map(parseRecord);
    const last = res.LastEvaluatedKey;
    const lastKey = last
      ? ListKeySchema.parse({ sk: last.sk, openedAtKey: last.openedAtKey })
      : undefined;
    return lastKey ? { items, lastKey } : { items };
  }
}
