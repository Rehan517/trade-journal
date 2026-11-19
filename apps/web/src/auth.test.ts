import { describe, expect, it } from 'vitest';
import { buildLogoutUrl, buildOidcSettings, clearAuthParams } from './auth.ts';

const config = {
  region: 'ap-southeast-2',
  userPoolId: 'ap-southeast-2_AbCdEf123',
  userPoolClientId: 'client123',
  authDomain: 'https://example.auth.ap-southeast-2.amazoncognito.com',
};

describe('buildOidcSettings', () => {
  const settings = buildOidcSettings(config, 'https://d111.cloudfront.net');

  it('builds the Cognito authority and client id', () => {
    expect(settings.authority).toBe(
      'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbCdEf123',
    );
    expect(settings.client_id).toBe('client123');
  });

  it('uses the origin root with trailing slash for redirects', () => {
    expect(settings.redirect_uri).toBe('https://d111.cloudfront.net/');
    expect(settings.post_logout_redirect_uri).toBe(
      'https://d111.cloudfront.net/',
    );
  });

  it('uses the code flow with openid email scope', () => {
    expect(settings.response_type).toBe('code');
    expect(settings.scope).toBe('openid email');
  });

  it('removes code and state from the URL after sign-in', () => {
    window.history.replaceState({}, '', '/?code=abc&state=xyz&keep=1');
    settings.onSigninCallback?.(undefined);
    expect(window.location.search).toBe('?keep=1');
  });
});

describe('clearAuthParams', () => {
  it('removes code, state and error parameters and keeps the rest', () => {
    window.history.replaceState(
      {},
      '',
      '/trades?code=abc&state=xyz&error=e&error_description=d&keep=1#top',
    );
    clearAuthParams();
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe('/trades?keep=1#top');
  });
});

describe('buildLogoutUrl', () => {
  it('includes client_id and the encoded logout_uri', () => {
    const url = buildLogoutUrl(config, 'http://localhost:5173');
    expect(url).toBe(
      `${config.authDomain}/logout?client_id=client123&logout_uri=${encodeURIComponent('http://localhost:5173/')}`,
    );
    expect(url).toContain('logout_uri=http%3A%2F%2Flocalhost%3A5173%2F');
  });
});
