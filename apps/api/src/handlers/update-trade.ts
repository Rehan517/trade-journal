import {
  TradeSchema,
  UpdateTradeRequestSchema,
  applyTradePatch,
  toTradeView,
} from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { z } from 'zod';
import { getUserId } from '../lib/auth.js';
import { defaultStore, type HandlerDeps } from '../lib/deps.js';
import {
  badRequest,
  conflict,
  internalError,
  json,
  notFound,
  unauthorized,
  validationError,
} from '../lib/http.js';
import { TradeConflictError, TradeNotFoundError } from '../lib/trade-store.js';

export const makeHandler =
  ({ store, now = () => new Date() }: HandlerDeps) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const userId = getUserId(event);
    if (userId === undefined) return unauthorized();

    // Checked before the body: a bad id is 404 even with a bad body.
    const id = z.uuid().safeParse(event.pathParameters?.id);
    if (!id.success) return notFound();

    let raw: unknown;
    try {
      const text = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
        : (event.body ?? '');
      raw = JSON.parse(text);
    } catch {
      return badRequest('Body must be valid JSON');
    }

    const patch = UpdateTradeRequestSchema.safeParse(raw);
    if (!patch.success) return validationError('Invalid trade', patch.error);

    try {
      // Ids are stored lowercase (randomUUID); z.uuid() also accepts uppercase.
      const stored = await store.get(userId, id.data.toLowerCase(), {
        consistent: true,
      });
      if (!stored) return notFound();

      const merged = TradeSchema.safeParse(
        applyTradePatch(stored.trade, patch.data),
      );
      if (!merged.success)
        return validationError('Invalid trade', merged.error);

      const updatedAt = nextUpdatedAt(now(), stored.updatedAt);
      await store.replace(
        userId,
        { trade: merged.data, createdAt: stored.createdAt, updatedAt },
        stored.updatedAt,
      );
      return json(200, toTradeView(merged.data, stored.createdAt, updatedAt));
    } catch (err) {
      if (err instanceof TradeNotFoundError) return notFound();
      if (err instanceof TradeConflictError) return conflict();
      console.error('update-trade failed', err);
      return internalError();
    }
  };

/**
 * `updatedAt` is the version the next write is conditional on, so it must
 * change on every write. Now, unless now isn't later than the stored value
 * (two writes in one millisecond, or a clock behind the last writer's): then
 * 1 ms after it.
 */
export function nextUpdatedAt(now: Date, stored: string): string {
  const floor = Date.parse(stored) + 1;
  return new Date(Math.max(now.getTime(), floor)).toISOString();
}

export const handler = makeHandler({ store: defaultStore });
