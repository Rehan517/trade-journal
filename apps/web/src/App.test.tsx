import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from 'react-oidc-context';
import App from './App.tsx';
import { AuthView } from './AuthView.tsx';

vi.mock('react-oidc-context', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const config = {
  region: 'ap-southeast-2',
  userPoolId: 'ap-southeast-2_AbCdEf123',
  userPoolClientId: 'client123',
  authDomain: 'https://example.auth.ap-southeast-2.amazoncognito.com',
  apiUrl: 'https://abc123defg.execute-api.ap-southeast-2.amazonaws.com',
};

function mockAuth(value: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: false,
    signinRedirect: vi.fn(),
    removeUser: vi.fn(),
    ...value,
  } as unknown as ReturnType<typeof useAuth>);
}

/** A fetch that answers `GET /trades` with an empty page, and nothing else. */
function emptyMonthFetch() {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    ),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const signedIn = {
  isAuthenticated: true,
  user: { access_token: 'tok', profile: { email: 'me@example.com' } },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthView', () => {
  it('shows Sign in when signed out and does not redirect on its own', () => {
    const signinRedirect = vi.fn();
    mockAuth({ signinRedirect });
    render(<AuthView config={config} />);
    expect(screen.getByRole('heading', { name: 'Trade Journal' })).toBeTruthy();
    expect(signinRedirect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it('shows the top bar, Sign out and the empty calendar when signed in', async () => {
    mockAuth(signedIn);
    render(<AuthView config={config} fetchFn={emptyMonthFetch()} />);
    expect(screen.getByText('Trade Journal')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Calendar' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('button', { name: 'New trade' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: /^[A-Z][a-z]+ \d{4}$/ }),
    ).toBeTruthy();
    expect(await screen.findByText(/No trades in/)).toBeTruthy();
    // The form is in a dialog that isn't open yet.
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
    expect(screen.queryByText(/Token user ID/)).toBeNull();
  });

  it('opens the New trade dialog from the top bar and from the empty month', async () => {
    mockAuth(signedIn);
    render(<AuthView config={config} fetchFn={emptyMonthFetch()} />);
    fireEvent.click(screen.getByRole('button', { name: 'New trade' }));
    expect(screen.getByRole('heading', { name: 'New trade' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save trade' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Log a trade' }));
    expect(screen.getByRole('button', { name: 'Save trade' })).toBeTruthy();
  });

  it('shows the error and Try again', () => {
    const signinRedirect = vi.fn();
    mockAuth({ error: new Error('access_denied'), signinRedirect });
    render(<AuthView config={config} />);
    expect(screen.getByText('Sign-in failed: access_denied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(signinRedirect).toHaveBeenCalledOnce();
  });

  it('Sign out clears the local user, then ends the Cognito session', async () => {
    const calls: string[] = [];
    const removeUser = vi.fn(() => {
      calls.push('removeUser');
      return Promise.resolve();
    });
    const navigate = vi.fn((url: string) => calls.push(url));
    mockAuth({
      isAuthenticated: true,
      user: { profile: { email: 'me@example.com' } },
      removeUser,
    });
    render(<AuthView config={config} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(calls).toEqual([
      'removeUser',
      `${config.authDomain}/logout?client_id=client123&logout_uri=${encodeURIComponent(`${window.location.origin}/`)}`,
    ]);
  });

  it('Sign out still ends the Cognito session if clearing the local user fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const navigate = vi.fn();
    mockAuth({
      isAuthenticated: true,
      user: { profile: { email: 'me@example.com' } },
      removeUser: vi.fn(() => Promise.reject(new Error('storage'))),
    });
    render(<AuthView config={config} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  });

  it('keeps the signed-in view (with Sign out) when a background renewal fails', () => {
    mockAuth({
      isAuthenticated: true,
      user: { profile: { email: 'me@example.com' } },
      error: new Error('refresh failed'),
    });
    render(<AuthView config={config} />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('clears ?error= from the address bar after a failed sign-in', () => {
    window.history.replaceState(
      {},
      '',
      '/?error=access_denied&error_description=nope&state=s1',
    );
    mockAuth({ error: new Error('access_denied') });
    render(<AuthView config={config} />);
    expect(window.location.search).toBe('');
  });

  it('shows a loading state while auth loads', () => {
    mockAuth({ isLoading: true });
    render(<AuthView config={config} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});

describe('AuthView signed in', () => {
  it('a 201 closes the dialog, shows "Trade saved" and refocuses the clicked button', async () => {
    mockAuth({
      isAuthenticated: true,
      user: { access_token: 'tok', profile: { sub: 'sub-1' } },
    });
    // The month is empty until the trade is saved, then holds that trade.
    const saved = {
      id: '3f0c1c52-6a3a-4f0e-9d0c-8a8f4f3b7a11',
      symbol: 'AAPL',
      instrumentType: 'stock',
      side: 'long',
      quantity: '1',
      entryPrice: '5',
      openedAt: new Date().toISOString(),
      fees: '0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metrics: {},
    };
    let didSave = false;
    // The refetch after the save is held until the test releases it, so the
    // moment focus is back on the opener can't be skipped by a fast refetch.
    let releaseRefetch: () => void = () => undefined;
    const refetched = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    const fetchFn = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        didSave = true;
        return Promise.resolve(
          new Response(JSON.stringify(saved), { status: 201 }),
        );
      }
      const month = () =>
        new Response(JSON.stringify({ items: didSave ? [saved] : [] }), {
          status: 200,
        });
      return didSave ? refetched.then(month) : Promise.resolve(month());
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    render(<AuthView config={config} fetchFn={fetchFn} />);
    const opener = await screen.findByRole('button', { name: 'Log a trade' });
    fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText('Symbol'), {
      target: { value: 'AAPL' },
    });
    fireEvent.change(screen.getByLabelText('Qty'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Entry'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save trade' }));
    await waitFor(() => expect(screen.getByText('Trade saved')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Save trade' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    // The calendar fetches the month again; the empty-month button goes with
    // it, and focus moves to the month title instead of falling to the body.
    releaseRefetch();
    await waitFor(() => {
      const gets = vi
        .mocked(fetchFn)
        .mock.calls.filter(([, init]) => init?.method !== 'POST');
      expect(gets).toHaveLength(2);
      expect(opener.isConnected).toBe(false);
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1 }),
      ),
    );
  });

  it('makes no save call just by showing the form', async () => {
    mockAuth({
      isAuthenticated: true,
      user: { access_token: 'tok', profile: { sub: 'sub-1' } },
    });
    const fetchFn = emptyMonthFetch();
    render(<AuthView config={config} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: 'New trade' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await screen.findByText(/No trades in/);
    // The calendar's GET /trades is the only call.
    for (const [, init] of vi.mocked(fetchFn).mock.calls) {
      expect((init as RequestInit | undefined)?.method).toBe('GET');
    }
  });
});

describe('App', () => {
  it("shows an error and does not start sign-in when config can't load", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAuth({});
    render(<App load={() => Promise.reject(new Error('bad'))} />);
    await waitFor(() =>
      expect(screen.getByText("Couldn't load app configuration")).toBeTruthy(),
    );
    expect(useAuth).not.toHaveBeenCalled();
  });

  it('renders the auth view once config loads', async () => {
    mockAuth({});
    render(<App load={() => Promise.resolve(config)} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy(),
    );
  });
});
