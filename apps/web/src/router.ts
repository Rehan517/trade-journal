import { useEffect, useRef, useSyncExternalStore } from 'react';

export type Route = 'calendar' | 'trades';

export const PATHS: Record<Route, string> = {
  calendar: '/',
  trades: '/trades',
};
const TITLES: Record<Route, string> = {
  calendar: 'Calendar · Trade Journal',
  trades: 'Trades · Trade Journal',
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const getPath = () => window.location.pathname;

/** Moves to `path` without reloading, as a new history entry. */
export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  notify();
}

/**
 * The page the address bar names. A path that isn't a page shows the
 * calendar and is replaced with `/`.
 */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, getPath, () => '/');
  const route: Route = path === PATHS.trades ? 'trades' : 'calendar';
  const known = path === PATHS.trades || path === PATHS.calendar;
  useEffect(() => {
    if (known) return;
    window.history.replaceState(null, '', PATHS.calendar);
    notify();
  }, [known]);
  return route;
}

/**
 * Sets the document title for the route. After a route change it also
 * scrolls to the top and moves focus to the page's `<h1>`, so a screen
 * reader announces the new page (focus stays put while `suspended`). The first render leaves focus alone.
 */
export function useRouteEffects(route: Route, suspended = false): void {
  const previous = useRef<Route | null>(null);
  // Read inside the effect, so opening or closing a dialog is not a change.
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    suspendedRef.current = suspended;
  });
  useEffect(() => {
    document.title = TITLES[route];
    const changed = previous.current !== null && previous.current !== route;
    previous.current = route;
    if (!changed) return;
    window.scrollTo(0, 0);
    // A dialog is open: focus stays in it. The shell moves focus to the
    // page's title when the dialog closes and its opener is gone.
    if (suspendedRef.current) return;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [route]);
}
