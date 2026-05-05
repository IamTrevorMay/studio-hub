import { renderHook, act } from '@testing-library/react';

// Mock supabaseClient before importing the hook
const mockRefreshSession = jest.fn();
jest.mock('../../supabaseClient', () => ({
  supabase: {
    auth: {
      refreshSession: mockRefreshSession,
    },
  },
}));

const { useSupabaseQuery } = require('../../hooks/useSupabaseQuery');

describe('useSupabaseQuery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns data on successful query', async () => {
    const { result } = renderHook(() => useSupabaseQuery());
    let res;
    await act(async () => {
      res = await result.current.safeQuery(() =>
        Promise.resolve({ data: [{ id: 1 }], error: null })
      );
    });
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.error).toBeNull();
  });

  it('retries on JWT error after refreshing session', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: 'new' } },
      error: null,
    });

    let callCount = 0;
    const queryFn = () => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: null, error: { message: 'JWT expired', code: '' } });
      }
      return Promise.resolve({ data: [{ id: 2 }], error: null });
    };

    const { result } = renderHook(() => useSupabaseQuery());
    let res;
    await act(async () => {
      res = await result.current.safeQuery(queryFn);
    });

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(2);
    expect(res.data).toEqual([{ id: 2 }]);
  });

  it('retries on PGRST301 code', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: 'new' } },
      error: null,
    });

    let callCount = 0;
    const queryFn = () => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: null, error: { message: '', code: 'PGRST301' } });
      }
      return Promise.resolve({ data: 'ok', error: null });
    };

    const { result } = renderHook(() => useSupabaseQuery());
    let res;
    await act(async () => {
      res = await result.current.safeQuery(queryFn);
    });

    expect(callCount).toBe(2);
    expect(res.data).toBe('ok');
  });

  it('returns original error when refresh fails', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'refresh failed' },
    });

    const originalError = { message: 'JWT expired', code: '' };
    const { result } = renderHook(() => useSupabaseQuery());
    let res;
    await act(async () => {
      res = await result.current.safeQuery(() =>
        Promise.resolve({ data: null, error: originalError })
      );
    });

    expect(res.error).toBe(originalError);
    expect(res.data).toBeNull();
  });

  it('catches thrown exceptions and returns error', async () => {
    const thrown = new Error('network failure');
    const { result } = renderHook(() => useSupabaseQuery());
    let res;
    await act(async () => {
      res = await result.current.safeQuery(() => { throw thrown; });
    });

    expect(res.data).toBeNull();
    expect(res.error).toBe(thrown);
  });
});
