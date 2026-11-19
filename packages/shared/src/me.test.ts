import { describe, expect, it } from 'vitest';
import { MeResponseSchema } from './me.js';

describe('MeResponseSchema', () => {
  it('accepts a userId', () => {
    expect(MeResponseSchema.parse({ userId: 'abc' })).toEqual({
      userId: 'abc',
    });
  });

  it.each([{}, { userId: '' }, { userId: 1 }])('rejects %j', (value) => {
    expect(MeResponseSchema.safeParse(value).success).toBe(false);
  });
});
