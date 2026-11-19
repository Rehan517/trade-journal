import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/**
 * The caller's Cognito `sub`, or undefined if the request isn't from a valid
 * access token. The JWT authorizer also accepts ID tokens (their `aud` is the
 * client ID), but the API takes access tokens only.
 */
export function getUserId(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string | undefined {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub: unknown = claims?.sub;
  if (claims?.token_use !== 'access') return undefined;
  if (typeof sub !== 'string' || sub === '') return undefined;
  return sub;
}
