import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { buildLogoutUrl, clearAuthParams } from './auth.ts';
import type { AppConfig } from './config.ts';
import { TradeForm } from './TradeForm.tsx';

export function AuthView({
  config,
  navigate = (url) => window.location.assign(url),
  fetchFn,
}: {
  config: AppConfig;
  /** Full-page navigation; replaceable in tests. */
  navigate?: (url: string) => void;
  /** Used for the save call; replaceable in tests. */
  fetchFn?: typeof fetch;
}) {
  const auth = useAuth();
  // A failed callback leaves ?code= or ?error= behind; clear it so a reload
  // doesn't retry the same failing callback.
  useEffect(() => {
    if (auth.error) clearAuthParams();
  }, [auth.error]);

  // Checked before the error: a failed background token renewal raises an
  // error too, and a signed-in user must still be able to sign out.
  if (auth.isAuthenticated) {
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
    return (
      <div className="shell">
        <header className="topbar">
          <span className="topbar__brand">Trade Journal</span>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </header>
        <main className="screen">
          <TradeForm
            apiUrl={config.apiUrl}
            accessToken={auth.user?.access_token}
            onSignIn={() => void auth.signinRedirect()}
            fetchFn={fetchFn}
          />
        </main>
      </div>
    );
  }

  if (auth.error) {
    return (
      <main className="page">
        <h1>Trade Journal</h1>
        <p role="alert">Sign-in failed: {auth.error.message}</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void auth.signinRedirect()}
        >
          Try again
        </button>
      </main>
    );
  }

  if (auth.isLoading) {
    return (
      <main className="page">
        <h1>Trade Journal</h1>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Trade Journal</h1>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void auth.signinRedirect()}
      >
        Sign in
      </button>
    </main>
  );
}
