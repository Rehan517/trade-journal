import { CreateTradeRequestSchema, toTradeView } from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { getUserId } from '../lib/auth.js';
import { defaultStore, type HandlerDeps } from '../lib/deps.js';
import {
  badRequest,
  internalError,
  json,
  unauthorized,
  validationError,
} from '../lib/http.js';

export const makeHandler =
  ({ store, now = () => new Date(), newId = randomUUID }: HandlerDeps) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const userId = getUserId(event);
    if (userId === undefined) return unauthorized();

    let raw: unknown;
    try {
      const text = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
        : (event.body ?? '');
      raw = JSON.parse(text);
    } catch {
      return badRequest('Body must be valid JSON');
    }

    const parsed = CreateTradeRequestSchema.safeParse(raw);
    if (!parsed.success) return validationError('Invalid trade', parsed.error);

    try {
      const stamp = now().toISOString();
      const trade = { ...parsed.data, id: newId() };
      await store.put(userId, { trade, createdAt: stamp, updatedAt: stamp });
      return json(201, toTradeView(trade, stamp, stamp));
    } catch (err) {
      console.error('create-trade failed', err);
      return internalError();
    }
  };

export const handler = makeHandler({ store: defaultStore });
