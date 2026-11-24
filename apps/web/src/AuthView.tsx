import { useEffect, useRef, useState } from 'react';
import type { TradeView } from '@trade-journal/shared';
import { useAuth } from 'react-oidc-context';
import { buildLogoutUrl, clearAuthParams } from './auth.ts';
import type { AppConfig } from './config.ts';
import { CalendarPage } from './CalendarPage.tsx';
import { Toast } from './FormParts.tsx';
import { NavLink } from './NavLink.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { useRoute, useRouteEffects } from './router.ts';
import { TradeDialog } from './TradeDialog.tsx';
import type { TradeFormMode } from './TradeForm.tsx';
import { TradesPage } from './TradesPage.tsx';
import { useSymbols } from './useSymbols.ts';

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
    return <Shell config={config} navigate={navigate} fetchFn={fetchFn} />;
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

/** The signed-in app: top bar, the page for the route, and the dialog. */
function Shell({
  config,
  navigate,
  fetchFn,
}: {
  config: AppConfig;
  navigate: (url: string) => void;
  fetchFn?: typeof fetch;
}) {
  const auth = useAuth();
  const route = useRoute();
  // Saved point values, loaded once per sign-in for the dialog and Settings.
  const symbols = useSymbols(config.apiUrl, auth.user?.access_token, fetchFn);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The button that opened the dialog. Safari doesn't focus a clicked
  // button, so the dialog can't rely on `document.activeElement`.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  // Entry time for the dialog's next open; undefined means now.
  const [initialOpenedAt, setInitialOpenedAt] = useState<string>();
  // What the dialog is for: a new trade, or a stored one to edit or close.
  const [target, setTarget] = useState<{
    mode: TradeFormMode;
    trade?: TradeView;
  }>({ mode: 'new' });
  // After a delete the opener is gone, so focus goes to the page title.
  const focusTitleOnClose = useRef(false);
  // Bumped after a save, so the page on screen fetches its data again.
  const [refreshKey, setRefreshKey] = useState(0);
  useRouteEffects(route, dialogOpen);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !dialogOpen;
    wasOpen.current = dialogOpen;
    if (closed && focusTitleOnClose.current) {
      focusTitleOnClose.current = false;
      document.querySelector<HTMLElement>('main h1')?.focus();
      return;
    }
    if (!closed || !opener || opener.isConnected) return;
    // The opener was on a page the trader left while the dialog was open.
    if (
      document.activeElement === document.body ||
      document.activeElement === null
    ) {
      document.querySelector<HTMLElement>('main h1')?.focus();
    }
  }, [dialogOpen, opener]);
  const openDialog = (button: HTMLElement, openedAt?: string) => {
    setTarget({ mode: 'new' });
    setOpener(button);
    setInitialOpenedAt(openedAt);
    setDialogOpen(true);
  };
  const openTrade = (
    trade: TradeView,
    mode: 'edit' | 'close',
    button: HTMLElement,
  ) => {
    setTarget({ mode, trade });
    setOpener(button);
    setInitialOpenedAt(undefined);
    setDialogOpen(true);
  };
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  const toastId = useRef(0);
  const page = {
    apiUrl: config.apiUrl,
    accessToken: auth.user?.access_token,
    onSignIn: () => void auth.signinRedirect(),
    fetchFn,
    onLogTrade: (openedAt: string | undefined, button: HTMLElement) =>
      openDialog(button, openedAt),
    refreshKey,
  };
  const announce = (message: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message });
  };
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
            <NavLink
              className="topbar__link"
              route="calendar"
              current={route === 'calendar'}
            >
              Calendar
            </NavLink>
            <NavLink
              className="topbar__link"
              route="trades"
              current={route === 'trades'}
            >
              Trades
            </NavLink>
            <NavLink
              className="topbar__link"
              route="settings"
              current={route === 'settings'}
            >
              Settings
            </NavLink>
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
        {route === 'trades' ? (
          <TradesPage {...page} onOpenTrade={openTrade} />
        ) : route === 'settings' ? (
          <SettingsPage
            apiUrl={page.apiUrl}
            accessToken={page.accessToken}
            onSignIn={page.onSignIn}
            fetchFn={fetchFn}
            symbols={symbols}
            announce={announce}
          />
        ) : (
          <CalendarPage {...page} />
        )}
      </main>
      <TradeDialog
        open={dialogOpen}
        returnFocusTo={opener}
        initialOpenedAt={initialOpenedAt}
        mode={target.mode}
        trade={target.trade}
        apiUrl={config.apiUrl}
        accessToken={auth.user?.access_token}
        onSignIn={() => void auth.signinRedirect()}
        fetchFn={fetchFn}
        symbols={symbols.saved}
        onSymbolSaved={symbols.applySaved}
        onClose={() => setDialogOpen(false)}
        onSaved={(_trade, message) => {
          setRefreshKey((k) => k + 1);
          announce(message);
        }}
        onDeleted={() => {
          focusTitleOnClose.current = true;
          setRefreshKey((k) => k + 1);
          announce('Trade deleted');
        }}
        onStale={() => setRefreshKey((k) => k + 1)}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
