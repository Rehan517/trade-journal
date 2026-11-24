import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { getUserId } from '../lib/auth.js';
import { internalError, json, unauthorized } from '../lib/http.js';
import {
  defaultSymbolStore,
  type SymbolHandlerDeps,
} from '../lib/symbol-deps.js';

export const makeHandler =
  ({ store }: SymbolHandlerDeps) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const userId = getUserId(event);
    if (userId === undefined) return unauthorized();

    try {
      return json(200, { items: await store.list(userId) });
    } catch (err) {
      console.error('list-symbols failed', err);
      return internalError();
    }
  };

export const handler = makeHandler({ store: defaultSymbolStore });
