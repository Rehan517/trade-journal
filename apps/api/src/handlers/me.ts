import type { MeResponse } from '@trade-journal/shared';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

// Per-user data: never let a browser or proxy cache it.
const headers = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

const unauthorized: APIGatewayProxyStructuredResultV2 = {
  statusCode: 401,
  headers,
  body: JSON.stringify({ message: 'Unauthorized' }),
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub: unknown = claims?.sub;

  // The JWT authorizer also accepts Cognito ID tokens (their `aud` is the
  // client ID). The API takes access tokens only.
  if (claims?.token_use !== 'access') return unauthorized;
  if (typeof sub !== 'string' || sub === '') return unauthorized;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ userId: sub } satisfies MeResponse),
  };
};
