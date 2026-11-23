import {
  ListTradesQuerySchema,
  toTradeView,
  type ListTradesResponse,
} from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { getUserId } from '../lib/auth.js';
import { defaultStore, type HandlerDeps } from '../lib/deps.js';
import {
  fieldError,
  internalError,
  json,
  unauthorized,
  validationError,
} from '../lib/http.js';
import {
  InvalidCursorError,
  decodeCursor,
  encodeCursor,
} from '../lib/trade-store.js';

export const makeHandler =
  ({ store }: HandlerDeps) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const userId = getUserId(event);
    if (userId === undefined) return unauthorized();

    const query = ListTradesQuerySchema.safeParse(
      event.queryStringParameters ?? {},
    );
    if (!query.success) return validationError('Invalid query', query.error);

    let startKey;
    if (query.data.cursor !== undefined) {
      startKey = decodeCursor(query.data.cursor);
      if (!startKey) {
        return fieldError('Invalid query', 'cursor', 'cursor is not valid');
      }
    }

    try {
      const { items, lastKey } = await store.list(userId, {
        limit: query.data.limit,
        startKey,
        from: query.data.from,
        to: query.data.to,
      });
      const body: ListTradesResponse = {
        items: items.map((r) => toTradeView(r.trade, r.createdAt, r.updatedAt)),
        ...(lastKey && { nextCursor: encodeCursor(lastKey) }),
      };
      return json(200, body);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        return fieldError('Invalid query', 'cursor', 'cursor is not valid');
      }
      console.error('list-trades failed', err);
      return internalError();
    }
  };

export const handler = makeHandler({ store: defaultStore });
