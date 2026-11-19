import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { buildLogoutUrl, clearAuthParams } from './auth.ts';
import { ApiError, fetchMe, INVALID_RESPONSE_STATUS } from './api.ts';
import type { AppConfig } from './config.ts';

type MeOutcome =
  { status: 'ok'; userId: string } | { status: 'error'; reason: string };

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === INVALID_RESPONSE_STATUS
      ? 'invalid response'
      : String(err.status);
  }
  // A rejected token may surface as a CORS failure, i.e. a TypeError.
  return 'network error';
}

export function AuthView({
  config,
  navigate = (url) => window.location.assign(url),
  fetchFn,
}: {
  config: AppConfig;
  /** Full-page navigation; replaceable in tests. */
  navigate?: (url: string) => void;
  /** Used for the API call; replaceable in tests. */
  fetchFn?: typeof fetch;
}) {
  const auth = useAuth();
  // The outcome is tagged with the request it belongs to, so a new token or
  // a retry reads as "loading" without setting state inside the effect.
  const [result, setResult] = useState<{
    key: string;
    outcome: MeOutcome;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const accessToken = auth.isAuthenticated
    ? auth.user?.access_token
    : undefined;
  const { apiUrl } = config;
  const requestKey = `${attempt}:${accessToken ?? ''}`;
  const me: { status: 'idle' | 'loading' } | MeOutcome = !accessToken
    ? { status: 'idle' }
    : result?.key === requestKey
      ? result.outcome
      : { status: 'loading' };

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    const settle = (outcome: MeOutcome) => {
      if (!controller.signal.aborted) setResult({ key: requestKey, outcome });
    };
    fetchMe(apiUrl, accessToken, fetchFn, controller.signal).then(
      (r) => settle({ status: 'ok', userId: r.userId }),
      (err: unknown) =>
        settle({ status: 'error', reason: describeFailure(err) }),
    );
    return () => controller.abort();
  }, [accessToken, apiUrl, fetchFn, requestKey]);

  // A failed callback leaves ?code= or ?error= behind; clear it so a reload
  // doesn't retry the same failing callback.
  useEffect(() => {
    if (auth.error) clearAuthParams();
  }, [auth.error]);

  // Checked before the error: a failed background token renewal raises an
  // error too, and a signed-in user must still be able to sign out.
  if (auth.isAuthenticated) {
    const email = auth.user?.profile.email;
    const signOut = async () => {
      try {
        await auth.removeUser();
      } catch (err) {
        // Still end the Cognito session; the logout page reloads the app,
        // which starts with no in-memory user either way.
        console.error('Clearing the local user failed', err);
      }
      navigate(buildLogoutUrl(config, window.location.origin));
    };
    const sub = auth.user?.profile.sub;
    return (
      <main>
        <h1>Trade Journal</h1>
        <p>Signed in as {typeof email === 'string' ? email : 'unknown user'}</p>
        <p>Token user ID: {typeof sub === 'string' ? sub : 'unknown'}</p>
        {me.status === 'loading' && <p>Calling API…</p>}
        {me.status === 'ok' && <p>API user ID: {me.userId}</p>}
        {me.status === 'error' && (
          <>
            <p role="alert">API call failed: {me.reason}</p>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </>
        )}
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  if (auth.error) {
    return (
      <main>
        <h1>Trade Journal</h1>
        <p role="alert">Sign-in failed: {auth.error.message}</p>
        <button type="button" onClick={() => void auth.signinRedirect()}>
          Try again
        </button>
      </main>
    );
  }

  if (auth.isLoading) {
    return (
      <main>
        <h1>Trade Journal</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Trade Journal</h1>
      <button type="button" onClick={() => void auth.signinRedirect()}>
        Sign in
      </button>
    </main>
  );
}
