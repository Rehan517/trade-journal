import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const valid = {
  region: 'ap-southeast-2',
  userPoolId: 'ap-southeast-2_AbCdEf123',
  userPoolClientId: 'client123',
  authDomain: 'https://example.auth.ap-southeast-2.amazoncognito.com',
};

const respond = (body: string, status = 200) =>
  (() =>
    Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

describe('loadConfig', () => {
  it('accepts a valid config', async () => {
    await expect(loadConfig(respond(JSON.stringify(valid)))).resolves.toEqual(
      valid,
    );
  });

  it('requests config.json without caching', async () => {
    let seen: [unknown, RequestInit | undefined] | undefined;
    const fetchFn = ((url: unknown, init?: RequestInit) => {
      seen = [url, init];
      return Promise.resolve(new Response(JSON.stringify(valid)));
    }) as typeof fetch;
    await loadConfig(fetchFn);
    expect(seen?.[0]).toBe('/config.json');
    expect(seen?.[1]?.cache).toBe('no-store');
  });

  it('rejects an HTML body', async () => {
    await expect(
      loadConfig(respond('<!doctype html><html></html>')),
    ).rejects.toThrow(/JSON/);
  });

  it('rejects a missing key', async () => {
    const { userPoolId: _omitted, ...rest } = valid;
    void _omitted;
    await expect(loadConfig(respond(JSON.stringify(rest)))).rejects.toThrow(
      /invalid/,
    );
  });

  it('rejects a non-https authDomain', async () => {
    const body = JSON.stringify({ ...valid, authDomain: 'http://example.com' });
    await expect(loadConfig(respond(body))).rejects.toThrow(/invalid/);
  });

  it('rejects an authDomain with a trailing slash', async () => {
    const body = JSON.stringify({
      ...valid,
      authDomain: `${valid.authDomain}/`,
    });
    await expect(loadConfig(respond(body))).rejects.toThrow(/invalid/);
  });

  it('rejects an authDomain that is not a Cognito domain', async () => {
    for (const authDomain of [
      'https://evil.example.com',
      'https://example.auth.ap-southeast-2.amazoncognito.com.evil.com',
      'https://example.auth.ap-southeast-2.amazoncognito.com?x=1',
      'https://user@example.auth.ap-southeast-2.amazoncognito.com',
    ]) {
      const body = JSON.stringify({ ...valid, authDomain });
      await expect(loadConfig(respond(body)), authDomain).rejects.toThrow(
        /invalid/,
      );
    }
  });

  it('rejects a region or user pool ID that could alter the authority URL', async () => {
    for (const patch of [
      { region: 'ap-southeast-2.evil.com/x' },
      { userPoolId: 'ap-southeast-2_abc/../x' },
      { userPoolId: 'us-east-1_AbCdEf123' }, // pool in a different region
      { userPoolClientId: 'client 123' },
    ]) {
      const body = JSON.stringify({ ...valid, ...patch });
      await expect(
        loadConfig(respond(body)),
        JSON.stringify(patch),
      ).rejects.toThrow(/invalid/);
    }
  });

  it('rejects a non-ok response', async () => {
    await expect(loadConfig(respond('nope', 500))).rejects.toThrow(/500/);
  });
});
