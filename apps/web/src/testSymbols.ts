/**
 * Test-only: answers the shell's one-off `GET /symbols` (#10 decision 10)
 * with the given saved values, and passes every other request on, so tests
 * about trades keep counting only their own requests.
 */
export function withSymbols(
  fetchFn: typeof fetch,
  items: { root: string; pointValue: string }[] = [],
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && String(input).endsWith('/symbols')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: items.map((i) => ({
              ...i,
              updatedAt: '2026-11-19T14:31:00.000Z',
            })),
          }),
          { status: 200 },
        ),
      );
    }
    return fetchFn(input, init);
  }) as typeof fetch;
}
