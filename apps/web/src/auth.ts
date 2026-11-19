import type { AuthProviderNoUserManagerProps } from 'react-oidc-context';
import type { AppConfig } from './config.ts';

/** Query parameters Cognito adds on the way back from managed login. */
const AUTH_PARAMS = ['code', 'state', 'error', 'error_description'];

/** Remove the sign-in callback parameters from the address bar. */
export function clearAuthParams(): void {
  const url = new URL(window.location.href);
  if (!AUTH_PARAMS.some((p) => url.searchParams.has(p))) return;
  for (const p of AUTH_PARAMS) url.searchParams.delete(p);
  window.history.replaceState(
    {},
    document.title,
    url.pathname + url.search + url.hash,
  );
}

export function buildOidcSettings(
  config: AppConfig,
  origin: string,
): AuthProviderNoUserManagerProps {
  return {
    authority: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    client_id: config.userPoolClientId,
    redirect_uri: `${origin}/`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: 'code',
    scope: 'openid email',
    onSigninCallback: clearAuthParams,
  };
}

export function buildLogoutUrl(config: AppConfig, origin: string): string {
  return `${config.authDomain}/logout?client_id=${encodeURIComponent(
    config.userPoolClientId,
  )}&logout_uri=${encodeURIComponent(`${origin}/`)}`;
}
