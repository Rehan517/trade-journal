import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { SymbolSettingSchema, type SymbolSetting } from '@trade-journal/shared';
import { CorruptItemError, userPk } from './trade-store.js';

export interface SymbolStore {
  /** The caller's saved settings, sorted by root. */
  list(userId: string): Promise<SymbolSetting[]>;
  /** Creates or replaces the setting for `setting.root`. */
  put(userId: string, setting: SymbolSetting): Promise<void>;
  /** Returns false when there was nothing to delete. */
  delete(userId: string, root: string): Promise<boolean>;
}

export const symbolSk = (root: string) => `SYMBOL#${root}`;

export const byRoot = (a: SymbolSetting, b: SymbolSetting) =>
  a.root < b.root ? -1 : a.root > b.root ? 1 : 0;

/** Parse a stored item back into a `SymbolSetting`. */
export function parseSetting(item: unknown): SymbolSetting {
  const parsed = SymbolSettingSchema.safeParse(item);
  if (!parsed.success) {
    throw new CorruptItemError('Stored symbol setting failed parsing');
  }
  return parsed.data;
}

function isConditionFailure(err: unknown): boolean {
  return (
    err instanceof ConditionalCheckFailedException ||
    (err instanceof Error && err.name === 'ConditionalCheckFailedException')
  );
}

export class DynamoSymbolStore implements SymbolStore {
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

  async list(userId: string): Promise<SymbolSetting[]> {
    const settings: SymbolSetting[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.client().send(
        new QueryCommand({
          TableName: this.tableName(),
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': userPk(userId) },
          ConsistentRead: true,
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) settings.push(parseSetting(item));
      startKey = res.LastEvaluatedKey;
    } while (startKey !== undefined);
    return settings.sort(byRoot);
  }

  async put(userId: string, setting: SymbolSetting): Promise<void> {
    await this.client().send(
      new PutCommand({
        TableName: this.tableName(),
        Item: {
          root: setting.root,
          pointValue: setting.pointValue,
          updatedAt: setting.updatedAt,
          pk: userPk(userId),
          sk: symbolSk(setting.root),
        },
      }),
    );
  }

  async delete(userId: string, root: string): Promise<boolean> {
    try {
      await this.client().send(
        new DeleteCommand({
          TableName: this.tableName(),
          Key: { pk: userPk(userId), sk: symbolSk(root) },
          ConditionExpression: 'attribute_exists(sk)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionFailure(err)) return false;
      throw err;
    }
  }
}
