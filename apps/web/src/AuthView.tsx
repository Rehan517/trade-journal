import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { buildLogoutUrl, clearAuthParams } from './auth.ts';
import type { AppConfig } from './config.ts';
import { Toast } from './FormParts.tsx';
import { TradeDialog } from './TradeDialog.tsx';

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
  const [dialogOpen, setDialogOpen] = useState(false);
  // The button that opened the dialog. Safari doesn't focus a clicked
  // button, so the dialog can't rely on `document.activeElement`.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const openDialog = (button: HTMLElement) => {
    setOpener(button);
    setDialogOpen(true);
  };
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  const toastId = useRef(0);
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
          <div className="topbar__inner">
            <span className="topbar__brand">
              <span className="topbar__logo" aria-hidden="true">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
                </svg>
              </span>
              Trade Journal
            </span>
            <nav className="topbar__nav" aria-label="Main">
              <a className="topbar__link" href="/" aria-current="page">
                Calendar
              </a>
            </nav>
            <button
              type="button"
              className="btn btn--primary topbar__new"
              onClick={(e) => openDialog(e.currentTarget)}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              New trade
            </button>
            <button
              type="button"
              className="btn btn--quiet topbar__out"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="home">
          <h1 className="home__title">Your trades</h1>
          <p className="home__text">Log a trade to start your journal.</p>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={(e) => openDialog(e.currentTarget)}
          >
            Log a trade
          </button>
        </main>
        <TradeDialog
          open={dialogOpen}
          returnFocusTo={opener}
          apiUrl={config.apiUrl}
          accessToken={auth.user?.access_token}
          onSignIn={() => void auth.signinRedirect()}
          fetchFn={fetchFn}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            toastId.current += 1;
            setToast({ id: toastId.current, message: 'Trade saved' });
          }}
        />
        <Toast toast={toast} onDismiss={() => setToast(null)} />
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
