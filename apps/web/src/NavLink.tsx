import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate, PATHS, type Route } from './router.ts';

/** A real link that navigates in the app on a plain left click. */
export function NavLink({
  route,
  current,
  onClick,
  children,
  ...rest
}: {
  route: Route;
  current?: boolean;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(PATHS[route]);
  };
  return (
    <a
      {...rest}
      href={PATHS[route]}
      aria-current={current ? 'page' : undefined}
      onClick={handle}
    >
      {children}
    </a>
  );
}
