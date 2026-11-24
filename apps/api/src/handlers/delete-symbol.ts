import { RootSchema } from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { getUserId } from '../lib/auth.js';
import {
  internalError,
  noContent,
  settingNotFound,
  unauthorized,
} from '../lib/http.js';
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

    const root = RootSchema.safeParse(
      event.pathParameters?.root?.toUpperCase(),
    );
    if (!root.success) return settingNotFound();

    try {
      const deleted = await store.delete(userId, root.data);
      return deleted ? noContent() : settingNotFound();
    } catch (err) {
      console.error('delete-symbol failed', err);
      return internalError();
    }
  };

export const handler = makeHandler({ store: defaultSymbolStore });
