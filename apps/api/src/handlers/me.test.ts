import { MeResponseSchema } from '@trade-journal/shared';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './me.js';

const eventWith = (
  authorizer: unknown,
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    rawPath: '/me',
    requestContext: authorizer === undefined ? {} : { authorizer },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

/** Claims from a Cognito access token, plus overrides. */
const withClaims = (claims: Record<string, unknown>) =>
  eventWith({
    jwt: { claims: { token_use: 'access', ...claims }, scopes: [] },
  });

const expectUnauthorized = (res: Awaited<ReturnType<typeof handler>>) => {
  expect(res.statusCode).toBe(401);
  expect(res.headers?.['content-type']).toBe('application/json');
  expect(JSON.parse(res.body ?? '')).toEqual({ message: 'Unauthorized' });
};

describe('me handler', () => {
  it('returns 200 with the sub claim as userId', async () => {
    const res = await handler(withClaims({ sub: 'user-123' }));

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toBe('application/json');
    expect(res.headers?.['cache-control']).toBe('no-store');

    const body = MeResponseSchema.parse(JSON.parse(res.body ?? ''));
    expect(body.userId).toBe('user-123');
  });

  it('returns 401 for an ID token', async () => {
    expectUnauthorized(
      await handler(withClaims({ sub: 'user-123', token_use: 'id' })),
    );
  });

  it('returns 401 when token_use is missing', async () => {
    expectUnauthorized(
      await handler(
        eventWith({ jwt: { claims: { sub: 'user-123' }, scopes: [] } }),
      ),
    );
  });

  it('returns 401 when the authorizer is missing', async () => {
    expectUnauthorized(await handler(eventWith(undefined)));
  });

  it('returns 401 when claims have no sub', async () => {
    expectUnauthorized(await handler(withClaims({ client_id: 'abc' })));
  });

  it('returns 401 when sub is empty', async () => {
    expectUnauthorized(await handler(withClaims({ sub: '' })));
  });

  it('returns 401 when sub is not a string', async () => {
    expectUnauthorized(await handler(withClaims({ sub: 42 })));
  });
});
