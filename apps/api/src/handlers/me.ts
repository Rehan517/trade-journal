import type { MeResponse } from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { getUserId } from '../lib/auth.js';
import { json, unauthorized } from '../lib/http.js';

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const sub = getUserId(event);
  if (sub === undefined) return unauthorized();
  return json(200, { userId: sub } satisfies MeResponse);
};
