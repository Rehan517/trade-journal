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

  it('shows the email and Sign out when signed in', () => {
    mockAuth({
      isAuthenticated: true,
      user: { profile: { email: 'me@example.com' } },
    });
    render(<AuthView config={config} />);
    expect(screen.getByText('Signed in as me@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
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
    expect(screen.getByText('Signed in as me@example.com')).toBeTruthy();
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

describe('AuthView API call', () => {
  const signedIn = (token = 'tok') => ({
    isAuthenticated: true,
    user: {
      access_token: token,
      profile: { email: 'me@example.com', sub: 'sub-1' },
    },
  });
  const okFetch = () =>
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ userId: 'sub-1' }))),
    ) as unknown as typeof fetch;

  it('shows Calling API… then the API and token user IDs', async () => {
    mockAuth(signedIn());
    const fetchFn = okFetch();
    render(<AuthView config={config} fetchFn={fetchFn} />);
    expect(screen.getByText('Calling API…')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('API user ID: sub-1')).toBeTruthy(),
    );
    expect(screen.getByText('Token user ID: sub-1')).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
    expect(url).toBe(`${config.apiUrl}/me`);
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('does not call again on re-render with the same token', async () => {
    mockAuth(signedIn());
    const fetchFn = okFetch();
    const { rerender } = render(<AuthView config={config} fetchFn={fetchFn} />);
    await waitFor(() => screen.getByText('API user ID: sub-1'));
    rerender(<AuthView config={config} fetchFn={fetchFn} />);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('shows the status on failure and Retry calls again', async () => {
    mockAuth(signedIn());
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: 'sub-1' })),
      ) as unknown as typeof fetch;
    render(<AuthView config={config} fetchFn={fetchFn} />);
    await waitFor(() =>
      expect(screen.getByText('API call failed: 401')).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => screen.getByText('API user ID: sub-1'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shows a network error the same way', async () => {
    mockAuth(signedIn());
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as unknown as typeof fetch;
    render(<AuthView config={config} fetchFn={fetchFn} />);
    await waitFor(() =>
      expect(screen.getByText('API call failed: network error')).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows invalid response for a schema-invalid body', async () => {
    mockAuth(signedIn());
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response('{"nope":1}')),
    ) as unknown as typeof fetch;
    render(<AuthView config={config} fetchFn={fetchFn} />);
    await waitFor(() =>
      expect(
        screen.getByText('API call failed: invalid response'),
      ).toBeTruthy(),
    );
  });

  // A request that never settles, so the test controls what happens next.
  const pendingFetch = () =>
    vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  const signalOf = (fetchFn: typeof fetch): AbortSignal => {
    const init = vi.mocked(fetchFn).mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return init!.signal!;
  };

  it('aborts the request on unmount', () => {
    mockAuth(signedIn());
    const fetchFn = pendingFetch();
    const { unmount } = render(<AuthView config={config} fetchFn={fetchFn} />);
    const signal = signalOf(fetchFn);
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('aborts the request on sign-out and makes no new call', () => {
    mockAuth(signedIn());
    const fetchFn = pendingFetch();
    const { rerender } = render(<AuthView config={config} fetchFn={fetchFn} />);
    const signal = signalOf(fetchFn);
    mockAuth({});
    rerender(<AuthView config={config} fetchFn={fetchFn} />);
    expect(signal.aborted).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('ignores a result that settles after sign-out', async () => {
    mockAuth(signedIn());
    let resolve!: (r: Response) => void;
    const fetchFn = vi.fn(
      () => new Promise<Response>((r) => (resolve = r)),
    ) as unknown as typeof fetch;
    const { rerender } = render(<AuthView config={config} fetchFn={fetchFn} />);
    mockAuth({});
    rerender(<AuthView config={config} fetchFn={fetchFn} />);
    resolve(new Response(JSON.stringify({ userId: 'sub-1' })));
    // Signed back in with a new token: the stale result must not show up
    // before the new request settles.
    mockAuth(signedIn('tok-2'));
    rerender(<AuthView config={config} fetchFn={fetchFn} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('API user ID: sub-1')).toBeNull();
    expect(screen.getByText('Calling API…')).toBeTruthy();
  });

  it('does not call the API when signed out', () => {
    mockAuth({});
    const fetchFn = okFetch();
    render(<AuthView config={config} fetchFn={fetchFn} />);
    expect(fetchFn).not.toHaveBeenCalled();
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
