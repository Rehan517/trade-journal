import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
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
  get(userId: string, id: string): Promise<TradeRecord | undefined>;
  /** Newest `openedAt` first. */
  list(
    userId: string,
    options: { limit: number; startKey?: ListKey },
  ): Promise<ListResult>;
}

/** A stored item that doesn't parse. A server bug, not a user error. */
export class CorruptItemError extends Error {}

export const userPk = (userId: string) => `USER#${userId}`;
export const tradeSk = (id: string) => `TRADE#${id}`;

/**
 * `openedAt` with the fraction padded to 9 digits, then `#<id>`, so string
 * order matches time order and ties break by id.
 */
export function openedAtKey(openedAt: string, id: string): string {
  const [base = '', fraction = ''] = openedAt.slice(0, -1).split('.');
  return `${base}.${fraction.padEnd(9, '0').slice(0, 9)}Z#${id}`;
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

  async get(userId: string, id: string): Promise<TradeRecord | undefined> {
    const res = await this.client().send(
      new GetCommand({
        TableName: this.tableName(),
        Key: { pk: userPk(userId), sk: tradeSk(id) },
      }),
    );
    return res.Item === undefined ? undefined : parseRecord(res.Item);
  }

  async list(
    userId: string,
    options: { limit: number; startKey?: ListKey },
  ): Promise<ListResult> {
    const pk = userPk(userId);
    const res = await this.client().send(
      new QueryCommand({
        TableName: this.tableName(),
        IndexName: 'byOpenedAt',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ScanIndexForward: false,
        Limit: options.limit,
        ConsistentRead: true,
        ExclusiveStartKey: options.startKey && { ...options.startKey, pk },
      }),
    );
    const items = (res.Items ?? []).map(parseRecord);
    const last = res.LastEvaluatedKey;
    const lastKey = last
      ? ListKeySchema.parse({ sk: last.sk, openedAtKey: last.openedAtKey })
      : undefined;
    return lastKey ? { items, lastKey } : { items };
  }
}
