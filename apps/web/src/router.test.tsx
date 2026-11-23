import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from 'react-oidc-context';
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

function mockAuth(authenticated = true) {
  vi.mocked(useAuth).mockReturnValue({
    isLoading: false,
    isAuthenticated: authenticated,
    signinRedirect: vi.fn(),
    removeUser: vi.fn(),
    user: authenticated
      ? { access_token: 'tok', profile: { email: 'me@example.com' } }
      : undefined,
  } as unknown as ReturnType<typeof useAuth>);
}

const fetchFn = vi.fn(() =>
  Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })),
) as unknown as typeof fetch;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T15:00:00.000Z'));
  mockAuth();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(<AuthView config={config} fetchFn={fetchFn} />);
};
const h1 = () => screen.getByRole('heading', { level: 1 });
const tradesLink = () => screen.getByRole('link', { name: 'Trades' });
const calendarLink = () => screen.getByRole('link', { name: 'Calendar' });

describe('routes', () => {
  it('renders Trades at /trades', async () => {
    renderAt('/trades');
    expect(h1().textContent).toBe('Trades');
    expect(document.title).toBe('Trades · Trade Journal');
    await screen.findByText('No trades yet.');
  });

  it('renders the Calendar at /', async () => {
    renderAt('/');
    expect(h1().textContent).not.toBe('Trades');
    expect(document.title).toBe('Calendar · Trade Journal');
    await screen.findByText(/No trades in/);
  });

  it('renders the Calendar for an unknown path and replaces it with /', async () => {
    const before = window.history.length;
    renderAt('/nope/never');
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(h1().textContent).not.toBe('Trades');
    expect(document.title).toBe('Calendar · Trade Journal');
    expect(window.history.length).toBe(before);
  });

  it('does not rewrite /trades for a signed-out visit', () => {
    mockAuth(false);
    renderAt('/trades');
    expect(window.location.pathname).toBe('/trades');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('navigation', () => {
  it('a plain click pushes /trades without a reload and switches page', async () => {
    renderAt('/');
    const length = window.history.length;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    tradesLink().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/trades');
    expect(window.history.length).toBe(length + 1);
    await waitFor(() => expect(h1().textContent).toBe('Trades'));
  });

  it('links are real anchors with hrefs', () => {
    renderAt('/');
    expect(tradesLink().getAttribute('href')).toBe('/trades');
    expect(calendarLink().getAttribute('href')).toBe('/');
  });

  it.each([
    ['metaKey', { metaKey: true }],
    ['ctrlKey', { ctrlKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('a click with %s is left to the browser', (_name, init) => {
    renderAt('/');
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    tradesLink().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/');
  });

  it('popstate switches pages (back and forward)', async () => {
    renderAt('/');
    fireEvent.click(tradesLink());
    await waitFor(() => expect(h1().textContent).toBe('Trades'));
    // Back: the browser changes the URL, then fires popstate.
    window.history.replaceState(null, '', '/');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => expect(h1().textContent).not.toBe('Trades'));
    expect(document.title).toBe('Calendar · Trade Journal');
    // Forward.
    window.history.replaceState(null, '', '/trades');
    fireEvent(window, new PopStateEvent('popstate'));
    await waitFor(() => expect(h1().textContent).toBe('Trades'));
    expect(document.title).toBe('Trades · Trade Journal');
  });
});

describe('route effects', () => {
  it('moves focus to the new <h1>, scrolls to the top and sets the title', async () => {
    renderAt('/');
    fireEvent.click(tradesLink());
    await waitFor(() => expect(h1().textContent).toBe('Trades'));
    expect(document.activeElement).toBe(h1());
    expect(document.title).toBe('Trades · Trade Journal');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);

    fireEvent.click(calendarLink());
    await waitFor(() => expect(h1().textContent).not.toBe('Trades'));
    expect(document.activeElement).toBe(h1());
    expect(document.title).toBe('Calendar · Trade Journal');
  });

  it('leaves focus alone on the first render', () => {
    renderAt('/trades');
    expect(document.activeElement).toBe(document.body);
  });

  it('aria-current="page" follows the route', async () => {
    renderAt('/');
    expect(calendarLink().getAttribute('aria-current')).toBe('page');
    expect(tradesLink().getAttribute('aria-current')).toBeNull();
    fireEvent.click(tradesLink());
    await waitFor(() =>
      expect(tradesLink().getAttribute('aria-current')).toBe('page'),
    );
    expect(calendarLink().getAttribute('aria-current')).toBeNull();
  });
});
