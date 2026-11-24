import {
  PutSymbolRequestSchema,
  RootSchema,
  type SymbolSetting,
} from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { getUserId } from '../lib/auth.js';
import {
  badRequest,
  internalError,
  json,
  unauthorized,
  validationError,
} from '../lib/http.js';
import {
  defaultSymbolStore,
  type SymbolHandlerDeps,
} from '../lib/symbol-deps.js';

export const makeHandler =
  ({ store, now = () => new Date() }: SymbolHandlerDeps) =>
  async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const userId = getUserId(event);
    if (userId === undefined) return unauthorized();

    const root = RootSchema.safeParse(
      event.pathParameters?.root?.toUpperCase(),
    );
    if (!root.success) return badRequest('Invalid root');

    let raw: unknown;
    try {
      const text = event.isBase64Encoded
        ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
        : (event.body ?? '');
      raw = JSON.parse(text);
    } catch {
      return badRequest('Body must be valid JSON');
    }

    const parsed = PutSymbolRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return validationError('Invalid setting', parsed.error);
    }

    try {
      const setting: SymbolSetting = {
        root: root.data,
        pointValue: parsed.data.pointValue,
        updatedAt: now().toISOString(),
      };
      await store.put(userId, setting);
      return json(200, setting);
    } catch (err) {
      console.error('put-symbol failed', err);
      return internalError();
    }
  };

export const handler = makeHandler({ store: defaultSymbolStore });
