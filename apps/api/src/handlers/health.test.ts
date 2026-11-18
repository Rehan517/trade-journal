import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './health.js';

const event = { rawPath: '/health' } as APIGatewayProxyEventV2;

describe('health handler', () => {
  it('returns 200 with a JSON status body', async () => {
    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toBe('application/json');

    const body: unknown = JSON.parse(res.body ?? '');
    expect(body).toMatchObject({ status: 'ok', path: '/health' });
  });
});
