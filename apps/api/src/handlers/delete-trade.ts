import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { z } from 'zod';
import { getUserId } from '../lib/auth.js';
import { defaultStore, type HandlerDeps } from '../lib/deps.js';
import {
  internalError,
  noContent,
  notFound,
  unauthorized,
} from '../lib/http.js';

export const makeHandler =
  ({ store }: HandlerDeps) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const userId = getUserId(event);
    if (userId === undefined) return unauthorized();

    const id = z.uuid().safeParse(event.pathParameters?.id);
    if (!id.success) return notFound();

    try {
      // Ids are stored lowercase (randomUUID); z.uuid() also accepts uppercase.
      const deleted = await store.delete(userId, id.data.toLowerCase());
      return deleted ? noContent() : notFound();
    } catch (err) {
      console.error('delete-trade failed', err);
      return internalError();
    }
  };

export const handler = makeHandler({ store: defaultStore });
