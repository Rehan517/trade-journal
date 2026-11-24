import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSymbols } from './useSymbols.ts';

const apiUrl = 'https://api.example.com';

const setting = (root: string, pointValue: string) => ({
  root,
  pointValue,
  updatedAt: '2026-11-19T00:00:00.000Z',
});

const list = (...items: ReturnType<typeof setting>[]) =>
  new Response(JSON.stringify({ items }), { status: 200 });

describe('useSymbols', () => {
  it('loads once, and a token renewal does not load again', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(list(setting('MES', '6'))),
    ) as unknown as typeof fetch;
    const { result, rerender } = renderHook(
      ({ token }) => useSymbols(apiUrl, token, fetchFn),
      { initialProps: { token: 'first' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.saved.get('MES')).toBe('6');

    rerender({ token: 'renewed' });
    await act(async () => {});
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('ready');
  });

  it('keeps a save and a removal made while the first load is in flight', async () => {
    let answer: (r: Response) => void = () => undefined;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useSymbols(apiUrl, 'tok', fetchFn));
    expect(result.current.status).toBe('loading');

    act(() => {
      result.current.applySaved({ root: 'ZN', pointValue: '1000' });
      result.current.applyRemoved('NQ');
    });
    // The load answers with what the server had before those changes.
    await act(async () => {
      answer(list(setting('MES', '6'), setting('NQ', '25')));
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect([...result.current.saved].sort()).toEqual([
      ['MES', '6'],
      ['ZN', '1000'],
    ]);
  });
});
