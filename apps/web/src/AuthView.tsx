import { useEffect } from 'react';
import { useAuth } from 'react-oidc-context';
import { buildLogoutUrl, clearAuthParams } from './auth.ts';
import type { AppConfig } from './config.ts';

export function AuthView({
  config,
  navigate = (url) => window.location.assign(url),
}: {
  config: AppConfig;
  /** Full-page navigation; replaceable in tests. */
  navigate?: (url: string) => void;
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
    return (
      <main>
        <h1>Trade Journal</h1>
        <p>Signed in as {typeof email === 'string' ? email : 'unknown user'}</p>
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
