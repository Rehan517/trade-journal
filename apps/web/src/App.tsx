import { useEffect, useState } from 'react';
import { AuthProvider } from 'react-oidc-context';
import { AuthView } from './AuthView.tsx';
import { buildOidcSettings } from './auth.ts';
import { CONFIG_ERROR_MESSAGE, loadConfig, type AppConfig } from './config.ts';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; config: AppConfig };

function App({ load = loadConfig }: { load?: () => Promise<AppConfig> }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    load().then(
      (config) => {
        if (!cancelled) setState({ status: 'ready', config });
      },
      (err: unknown) => {
        console.error(err);
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (state.status === 'loading') {
    return (
      <main className="page">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="page">
        <h1>Trade Journal</h1>
        <p role="alert">{CONFIG_ERROR_MESSAGE}</p>
      </main>
    );
  }

  return (
    <AuthProvider {...buildOidcSettings(state.config, window.location.origin)}>
      <AuthView config={state.config} />
    </AuthProvider>
  );
}

export default App;
